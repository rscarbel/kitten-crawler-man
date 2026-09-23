/**
 * Rosemarie's review harness: the art gates first, then a contact sheet of
 * every row with Bernie composited on her shoulder the way the runtime draws
 * him, an in-game-size strip, and her standing behind the Meat Shields desk.
 *
 *   npm run render:rosemarie
 *   npx tsx scripts/render-rosemarie.ts --scale=8 --row=coin_toss_side
 *   npx tsx scripts/render-rosemarie.ts --mode=desk
 *   npx tsx scripts/render-rosemarie.ts --mode=head --scale=12
 *   npx tsx scripts/render-rosemarie.ts --mode=bernie --scale=16
 */

import { type Canvas, createCanvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { rosemarieGateFailures } from './gates-rosemarie.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { drawMercDesk } from '../src/sprites/art/clubFurnitureArt.js';
import {
  BERNIE_FIGURE,
  BERNIE_SEAT_X,
  BERNIE_SEAT_Y,
  BERNIE_SNUFFLE_STATE,
  FRAME_H,
  FRAME_W,
  GROUND_OFFSET_IN_TILE,
  ROSEMARIE_FIGURE,
  ROSEMARIE_ROWS,
  ROSEMARIE_VIEWS,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
  type RosemarieRow,
  rosemariePose,
  rosemarieStateName,
} from '../src/sprites/art/rosemarieFigure.js';
import { rosemarieBernieSeat, type RosemarieView } from '../src/sprites/art/rosemarieArt.js';
import { BERNIE_SNUFFLE_FRAMES } from '../src/sprites/rosemarieTiming.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
const DEFAULT_SCALE = 4;
const MIN_SCALE = 1;
const MAX_SCALE = 24;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2a2230';
/** The club's floor and two lighter grounds, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#2a1c2e', '#3b3b40', '#5a4a3a'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type Mode = 'sheet' | 'desk' | 'head' | 'bernie';
const MODES: ReadonlyArray<Mode> = ['sheet', 'desk', 'head', 'bernie'];

type SheetContext = ReturnType<Canvas['getContext']>;

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
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

interface StateRef {
  readonly row: RosemarieRow;
  readonly view: RosemarieView;
  readonly name: string;
}

function allStates(): StateRef[] {
  return ROSEMARIE_ROWS.flatMap((row) =>
    ROSEMARIE_VIEWS.map((view) => ({ row, view, name: rosemarieStateName(row, view) })),
  );
}

function selectedStates(): StateRef[] {
  const only = parseFlag('row', '');
  const states = allStates();
  if (only === '') return states;
  const picked = states.filter((state) => state.name === only);
  if (picked.length === 0)
    throw new Error(`--row=${only} is not one of ${states.map((s) => s.name).join(', ')}`);
  return picked;
}

function framesOf(name: string): number {
  const frames = ROSEMARIE_FIGURE.states.get(name)?.frames;
  if (frames === undefined) throw new Error(`rosemarie declares no state "${name}"`);
  return frames;
}

/**
 * Rosemarie with Bernie on her shoulder, painted at `density` cell pixels per
 * cell pixel. Bernie's frame is passed separately because his clock is his own.
 */
function composite(state: StateRef, frame: number, bernieFrame: number, density: number): Canvas {
  const canvas = createCanvas(Math.ceil(FRAME_W * density), Math.ceil(FRAME_H * density));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(paintFigureCell(ROSEMARIE_FIGURE, state.name, frame, density), 0, 0);
  const seat = rosemarieBernieSeat(state.view, rosemariePose(state.row, frame));
  const seatX = TILE_X + TILE_SCALE / 2 + seat.x * TILE_SCALE;
  const seatY = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE + seat.y * TILE_SCALE;
  ctx.drawImage(
    paintFigureCell(BERNIE_FIGURE, BERNIE_SNUFFLE_STATE, bernieFrame, density),
    (seatX - BERNIE_SEAT_X) * density,
    (seatY - BERNIE_SEAT_Y) * density,
  );
  return canvas;
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function label(ctx: SheetContext, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING);
}

function renderSheet(scale: number, outPath: string): void {
  const states = selectedStates();
  const cellW = FRAME_W * scale;
  const cellH = FRAME_H * scale;
  const maxCols = Math.max(...states.map((state) => framesOf(state.name)));
  const inGameW = FRAME_W * IN_GAME_SCALE;
  const inGameH = FRAME_H * IN_GAME_SCALE;
  const stripRows = states.length * FLOOR_SWATCHES.length;
  const { canvas, ctx } = newPanel(
    PADDING + Math.max(maxCols * (cellW + PADDING), maxCols * (inGameW + PADDING)),
    PADDING +
      states.length * (cellH + LABEL_HEIGHT + PADDING) +
      LABEL_HEIGHT +
      stripRows * (inGameH + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = framesOf(state.name);
    label(ctx, `${state.name} — ${frames} frames`, PADDING, y);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(composite(state, frame, frame % BERNIE_SNUFFLE_FRAMES, scale), x, y);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + TILE_X * scale,
        y + TILE_Y * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  });

  label(ctx, `in-game size (${IN_GAME_TILE}px tile), on each floor swatch`, PADDING, y);
  y += LABEL_HEIGHT;
  for (const state of states) {
    for (const swatch of FLOOR_SWATCHES) {
      const frames = framesOf(state.name);
      for (let frame = 0; frame < frames; frame++) {
        const x = PADDING + frame * (inGameW + PADDING);
        ctx.fillStyle = swatch;
        ctx.fillRect(x, y, inGameW, inGameH);
        // Baked at cell density and blitted down, as the cache does.
        ctx.drawImage(
          composite(state, frame, frame % BERNIE_SNUFFLE_FRAMES, 1),
          x,
          y,
          inGameW,
          inGameH,
        );
      }
      y += inGameH + PADDING;
    }
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/** Where she stands and where her desk sits in the club, in tiles. */
const DESK_TILE_OFFSET = { x: -1, y: 1 };
const DESK_WIDTH_TILES = 3;
const DESK_HEADROOM_TILES = 1;
const DESK_SCENE_TILES = { w: 5, h: 4 };
/** Her tile's top-left within the scene. */
const SCENE_TILE = { x: 2, y: 1 };
/** A close-up big enough to judge the face against the desk top. */
const DESK_CLOSE_UP_SCALE = 3;
const DESK_SCALES: ReadonlyArray<number> = [IN_GAME_SCALE, 1, DESK_CLOSE_UP_SCALE];

/**
 * Her in the club at three sizes: standing on her tile with the contract desk
 * painted in front of her, which is how the player sees her.
 */
function renderDesk(outPath: string): void {
  const scenes = DESK_SCALES.map((scale) => {
    const tile = TILE_SCALE * scale;
    const scene = createCanvas(DESK_SCENE_TILES.w * tile, DESK_SCENE_TILES.h * tile);
    const sctx = scene.getContext('2d');
    sctx.fillStyle = FLOOR_SWATCHES[0];
    sctx.fillRect(0, 0, scene.width, scene.height);
    const state = allStates()[0];
    const cell = composite(state, 0, 1, 1);
    const tileX = SCENE_TILE.x * tile;
    const tileY = SCENE_TILE.y * tile;
    sctx.drawImage(
      cell,
      tileX - TILE_X * scale,
      tileY - TILE_Y * scale,
      FRAME_W * scale,
      FRAME_H * scale,
    );
    const deskCanvas = createCanvas(
      DESK_WIDTH_TILES * TILE_SCALE,
      (DESK_HEADROOM_TILES + 1) * TILE_SCALE,
    );
    const footTop = DESK_HEADROOM_TILES * TILE_SCALE;
    drawMercDesk(
      asGameContext(deskCanvas.getContext('2d')),
      { w: deskCanvas.width, h: deskCanvas.height, footTop, footBottom: footTop + TILE_SCALE },
      0,
      0,
    );
    const deskX = (SCENE_TILE.x + DESK_TILE_OFFSET.x) * tile;
    const deskY = (SCENE_TILE.y + DESK_TILE_OFFSET.y - DESK_HEADROOM_TILES) * tile;
    sctx.drawImage(deskCanvas, deskX, deskY, deskCanvas.width * scale, deskCanvas.height * scale);
    return scene;
  });
  const width = PADDING + scenes.reduce((sum, scene) => sum + scene.width + PADDING, 0);
  const height = PADDING * 2 + LABEL_HEIGHT + Math.max(...scenes.map((scene) => scene.height));
  const { canvas, ctx } = newPanel(width, height);
  label(ctx, 'behind the Meat Shields desk: 32px tile, 64px, 192px', PADDING, PADDING);
  let x = PADDING;
  for (const scene of scenes) {
    ctx.drawImage(scene, x, PADDING + LABEL_HEIGHT);
    x += scene.width + PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath}`);
}

/** Crops of her head and shoulders — where the face, braids and Bernie live. */
const HEAD_CROP = { x0: 0.12, x1: 0.88, y0: 0.0, y1: 0.55 };

function renderHead(scale: number, outPath: string): void {
  const states = selectedStates();
  const cropW = (HEAD_CROP.x1 - HEAD_CROP.x0) * FRAME_W * scale;
  const cropH = (HEAD_CROP.y1 - HEAD_CROP.y0) * FRAME_H * scale;
  const maxCols = Math.max(...states.map((state) => framesOf(state.name)));
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cropW + PADDING),
    PADDING + states.length * (cropH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  for (const state of states) {
    label(ctx, state.name, PADDING, y);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < framesOf(state.name); frame++) {
      const cell = composite(state, frame, frame % BERNIE_SNUFFLE_FRAMES, scale);
      const x = PADDING + frame * (cropW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[0];
      ctx.fillRect(x, y, cropW, cropH);
      ctx.drawImage(
        cell,
        HEAD_CROP.x0 * cell.width,
        HEAD_CROP.y0 * cell.height,
        cropW,
        cropH,
        x,
        y,
        cropW,
        cropH,
      );
    }
    y += cropH + PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath}`);
}

function renderBernie(scale: number, outPath: string): void {
  const cellW = BERNIE_FIGURE.frameWidth * scale;
  const cellH = BERNIE_FIGURE.frameHeight * scale;
  const { canvas, ctx } = newPanel(
    PADDING + BERNIE_SNUFFLE_FRAMES * (cellW + PADDING),
    PADDING * 2 + LABEL_HEIGHT + cellH,
  );
  label(ctx, `Bernie — ${BERNIE_SNUFFLE_STATE}`, PADDING, PADDING);
  for (let frame = 0; frame < BERNIE_SNUFFLE_FRAMES; frame++) {
    const x = PADDING + frame * (cellW + PADDING);
    const y = PADDING + LABEL_HEIGHT;
    ctx.fillStyle = FLOOR_SWATCHES[1];
    ctx.fillRect(x, y, cellW, cellH);
    ctx.drawImage(paintFigureCell(BERNIE_FIGURE, BERNIE_SNUFFLE_STATE, frame, scale), x, y);
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath}`);
}

function main(): void {
  console.log('Rosemarie and Bernie art gates');
  const clean = reportFigureGates('rosemarie', rosemarieGateFailures());
  if (!clean) console.error('Rendering anyway so the failures can be looked at.');
  const mode = parseMode();
  const scale = parseScale();
  const out = parseFlag('out', `${PREVIEW_DIR}/rosemarie-${mode}.png`);
  if (mode === 'sheet') renderSheet(scale, out);
  else if (mode === 'desk') renderDesk(out);
  else if (mode === 'head') renderHead(scale, out);
  else renderBernie(scale, out);
}

main();
