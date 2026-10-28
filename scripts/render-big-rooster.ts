/**
 * The roosters' review harness. Art has to be judged as an image, by something
 * that only looks at the image: every defect that matters on a figure is
 * invisible to `typecheck`, `lint` and a code read.
 *
 * Cells are baked from the build's `FigureDef` exactly as the runtime cache
 * bakes them, the held dumbbell is drawn at the figure's own hand anchors as
 * the game draws it, and the art gates run first, so one command answers both
 * "does it still hold together" and "what does it look like".
 *
 *   npm run render:big-rooster -- --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --build=little --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --row=walk_side --scale=4 --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --part=head --scale=6 --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --mode=strip32 --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --row=walk_side --mode=onion --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --row=punch_side --mode=delta --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --row=club_swing_side --mode=arc --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --row=walk_side --mode=trails --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --mode=gore --scale=4 --out=<png>
 *   npx tsx scripts/render-big-rooster.ts --row=walk_side --frames=0,4,8,12 --scale=3 --out=<png>
 *
 * `--blind` captions rows by number only, for a blind reviewer.
 * `--held` draws the dumbbell on the rows he can play with or without one.
 * `--skip-gates` bakes the picture without gating it, for a quick look between
 * edits; a review image that is kept is always rendered with the gates on.
 */

import { type Canvas, type CanvasRenderingContext2D as NodeCtx, createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { roosterGateFailures } from './gates-rooster.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { drawGymFloorTile } from '../src/map/tiles/bossRooms/gymTiles.js';
import {
  BIG_ROOSTER_HAND_ANCHORS,
  GORE_STATES,
  ROOSTER_CELLS,
  ROOSTER_FIGURES,
  ROOSTER_ROWS,
  type RowSpec,
  beakTipOf,
  rightHandAnchor,
} from '../src/sprites/art/roosterFigure.js';
import {
  ROOSTER_BUILDS,
  ROOSTER_BUILD_SPECS,
  type RoosterBuild,
  buildRoosterSkeleton,
  ROOSTER_TILE_SCALE,
} from '../src/sprites/art/roosterArt.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { drawRoosterDumbbell } from '../src/sprites/roosterDumbbell.js';

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const BACKDROP = '#3b3b40';
const ONION_ALPHA = 0.4;
const DOT_RADIUS = 2.5;
const ARC_COLOR = 'rgba(255,120,60,0.95)';
const BEAK_COLOR = 'rgba(120,255,140,0.95)';
const TRAIL_COLORS = ['#ff5a5a', '#5ab4ff', '#ffd25a', '#b05aff', '#5affb0', '#ffffff'] as const;
const GROUND_LINE = 'rgba(255,255,255,0.35)';
const NO_FRAME = -1;
const MAX_FRAME_FLAG = 64;
/** The 32 px strip's nearest-neighbour copy, so single pixels can be read. */
const STRIP_ZOOM = 2;

type Mode = 'sheet' | 'parts' | 'gore' | 'onion' | 'delta' | 'arc' | 'trails' | 'strip32';
const MODES: ReadonlyArray<Mode> = [
  'sheet',
  'parts',
  'gore',
  'onion',
  'delta',
  'arc',
  'trails',
  'strip32',
];

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Fractions of the cell, so the table survives the cell being re-derived. */
const PARTS: Record<string, PartWindow> = {
  head: { x: 0.3, y: 0.0, w: 0.4, h: 0.3 },
  shoulders: { x: 0.2, y: 0.12, w: 0.6, h: 0.3 },
  arms: { x: 0.1, y: 0.15, w: 0.8, h: 0.5 },
  hands: { x: 0.12, y: 0.5, w: 0.76, h: 0.32 },
  legs: { x: 0.25, y: 0.5, w: 0.5, h: 0.45 },
  feet: { x: 0.25, y: 0.78, w: 0.55, h: 0.2 },
  tail: { x: 0.0, y: 0.05, w: 0.55, h: 0.55 },
};

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

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

function parseBuild(): RoosterBuild {
  const raw = parseFlag('build', 'big');
  const found = ROOSTER_BUILDS.find((build) => build === raw);
  if (found === undefined)
    throw new Error(`--build=${raw} is not one of ${ROOSTER_BUILDS.join(', ')}`);
  return found;
}

const build = parseBuild();
const figure = ROOSTER_FIGURES[build];
const cell = ROOSTER_CELLS[build];
const rows = ROOSTER_ROWS[build];

/**
 * Rows he plays with or without a dumbbell, reviewed without one: their held
 * version is the same picture with the weight at the anchor G16 holds to the fist.
 * `--held` reviews them holding it.
 */
const REVIEWED_EMPTY_HANDED: readonly string[] = process.argv.includes('--held')
  ? []
  : ['idle', 'peck', 'crow', 'sprint'];

/**
 * One cell as the game draws it: the baked body, with the dumbbell drawn at the
 * hand anchor on held frames (the rows he plays either way are reviewed
 * empty-handed, and the pickup shows the dumbbell waiting where his fist will
 * close on it) — behind him from the back, where his own back
 * hides his right hand, in front of him otherwise.
 */
function composedCell(state: string, frame: number, withDumbbell: boolean): Canvas {
  const out = createCanvas(figure.frameWidth, figure.frameHeight);
  const ctx = out.getContext('2d');
  const base = rows.find((row) => row.name === state)?.base;
  const held = BIG_ROOSTER_HAND_ANCHORS.get(state);
  // Before his fist closes on it, the dumbbell the pickup reaches for waits
  // where the fist will close — in the game it sits on the rack there.
  const waiting =
    base === 'pickup' ? (held?.find((candidate) => candidate !== null) ?? null) : null;
  const emptyHanded = base !== undefined && REVIEWED_EMPTY_HANDED.includes(base);
  const anchor = withDumbbell && !emptyHanded ? (held?.[frame] ?? waiting) : null;
  const paintDumbbell = (): void => {
    if (anchor === null) return;
    drawRoosterDumbbell(
      asGameContext(ctx),
      figure.tileX,
      figure.tileY,
      ROOSTER_TILE_SCALE,
      anchor,
      false,
    );
  };
  const behind = state.endsWith('_away');
  if (behind) paintDumbbell();
  ctx.drawImage(bakeFigureCell(figure, state, frame), 0, 0);
  if (!behind) paintDumbbell();
  return out;
}

function frameCountOf(state: string): number {
  const declared = figure.states.get(state);
  if (declared === undefined) throw new Error(`the ${build} rooster declares no state "${state}"`);
  return declared.frames;
}

/**
 * With `--blind` every row is captioned by its place alone, so a reviewer
 * naming the action from the picture is not told it by the caption.
 */
const blindLabels = process.argv.includes('--blind');

function labelOf(state: string, index = 0): string {
  if (blindLabels) return `row ${index + 1}`;
  const row = rows.find((candidate) => candidate.name === state);
  if (row === undefined) return `${state} — gore piece`;
  return `${row.name} — ${row.frameCount} frames, ${row.view}, ${row.kind}`;
}

/** Lays the gym's rubber floor under a strip, as the boss room paints it. */
function paintGymFloor(ctx: NodeCtx, top: number, width: number, height: number): void {
  const game = asGameContext(ctx);
  for (let ty = 0; ty * TILE_SIZE < height; ty++) {
    for (let tx = 0; tx * TILE_SIZE < width; tx++) {
      drawGymFloorTile(game, [], tx * TILE_SIZE, top + ty * TILE_SIZE, TILE_SIZE, tx, ty);
    }
  }
}

/** Every row's frames at the in-game 32 px tile on the gym floor, with a nearest-neighbour zoom under. */
function renderStrip(states: readonly string[]): Canvas {
  const inGame = TILE_SIZE / ROOSTER_TILE_SCALE;
  const cellW = Math.ceil(figure.frameWidth * inGame);
  const cellH = Math.ceil(figure.frameHeight * inGame);
  const maxFrames = Math.max(...states.map(frameCountOf));
  const rowH = LABEL_HEIGHT + cellH + cellH * STRIP_ZOOM + PADDING;
  const width = PADDING + maxFrames * (cellW * STRIP_ZOOM + PADDING);
  const canvas = createCanvas(width, PADDING + states.length * rowH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  states.forEach((state, index) => {
    const y = PADDING + index * rowH;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(labelOf(state, index), PADDING, y + LABEL_HEIGHT - PADDING);
    paintGymFloor(ctx, y + LABEL_HEIGHT, width, cellH + cellH * STRIP_ZOOM);
    for (let frame = 0; frame < frameCountOf(state); frame++) {
      const source = composedCell(state, frame, true);
      const x = PADDING + frame * (cellW * STRIP_ZOOM + PADDING);
      const small = createCanvas(cellW, cellH);
      const smallCtx = small.getContext('2d');
      smallCtx.imageSmoothingEnabled = true;
      smallCtx.drawImage(source, 0, 0, cellW, cellH);
      ctx.drawImage(small, x, y + LABEL_HEIGHT);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, x, y + LABEL_HEIGHT + cellH, cellW * STRIP_ZOOM, cellH * STRIP_ZOOM);
      ctx.imageSmoothingEnabled = true;
    }
  });
  return canvas;
}

function rowOf(state: string): RowSpec | undefined {
  return rows.find((candidate) => candidate.name === state);
}

/** Cell pixels of a rig point. */
function cellPoint(p: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: cell.frameWidth / 2 + p.x * cell.pxPerUnit,
    y: cell.groundRow + p.y * cell.pxPerUnit,
  };
}

function dot(ctx: NodeCtx, x: number, y: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

/** Traces the fist (and, on a peck, the beak tip) across a row over its first cell. */
function drawArc(
  ctx: NodeCtx,
  row: RowSpec,
  originX: number,
  originY: number,
  scale: number,
): void {
  for (let frame = 0; frame < row.frameCount; frame++) {
    const hand = build === 'big' ? rightHandAnchor(build, row.name, frame).at : null;
    if (hand !== null) {
      dot(
        ctx,
        originX + (figure.tileX + hand.x * ROOSTER_TILE_SCALE) * scale,
        originY + (figure.tileY + hand.y * ROOSTER_TILE_SCALE) * scale,
        ARC_COLOR,
      );
    }
    const beak = cellPoint(beakTipOf(build, row.name, frame));
    dot(ctx, originX + beak.x * scale, originY + beak.y * scale, BEAK_COLOR);
  }
}

/** Per-frame paths of both ankles, both wrists, the hip and the head, over the first cell. */
function drawTrails(
  ctx: NodeCtx,
  row: RowSpec,
  originX: number,
  originY: number,
  scale: number,
): void {
  const spec = ROOSTER_BUILD_SPECS[build];
  for (let frame = 0; frame < row.frameCount; frame++) {
    const s = buildRoosterSkeleton(row.pose(frame), row.view, spec);
    const points = [
      s.leftLeg.pad,
      s.rightLeg.pad,
      s.leftArm.end,
      s.rightArm.end,
      s.hip,
      s.headCentre,
    ];
    points.forEach((p, i) => {
      const at = cellPoint(p);
      dot(ctx, originX + at.x * scale, originY + at.y * scale, TRAIL_COLORS[i]);
    });
  }
  ctx.strokeStyle = GROUND_LINE;
  ctx.beginPath();
  ctx.moveTo(originX, originY + cell.groundRow * scale);
  ctx.lineTo(originX + figure.frameWidth * scale, originY + cell.groundRow * scale);
  ctx.stroke();
}

function main(): void {
  const outPath = parseFlag('out', `${PREVIEW_DIR}/rooster-${build}-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const partName = parseFlag('part', mode === 'parts' ? 'head' : '');
  const frameFilter = Math.round(parseNumberFlag('frame', NO_FRAME, NO_FRAME, MAX_FRAME_FLAG));
  const frameList = parseFlag('frames', '')
    .split(',')
    .filter((entry) => entry !== '')
    .map(Number);
  const part = partName === '' ? null : (PARTS[partName] ?? null);
  if (partName !== '' && part === null) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }

  const poseStates = rows.map((row) => row.name);
  const allStates = [...poseStates, ...GORE_STATES];
  const wanted = rowFilter === '' ? null : rowFilter.split(',');
  const states =
    mode === 'gore'
      ? [...GORE_STATES]
      : wanted === null
        ? mode === 'strip32'
          ? poseStates
          : allStates
        : allStates.filter((state) => wanted.includes(state));
  if (states.length === 0)
    throw new Error(`--row=${rowFilter} matches none of ${allStates.join(', ')}`);

  if (!process.argv.includes('--skip-gates')) {
    console.log(`Gating the ${build} rooster…`);
    reportFigureGates(`${build} rooster`, roosterGateFailures(build));
  }

  if (mode === 'strip32') {
    const strip = renderStrip(states);
    writePreviewPng(outPath, strip.toBuffer('image/png'));
    console.log(`Wrote ${outPath} (${strip.width}×${strip.height}px, strip32)`);
    return;
  }

  const srcW = part === null ? figure.frameWidth : Math.round(part.w * figure.frameWidth);
  const srcH = part === null ? figure.frameHeight : Math.round(part.h * figure.frameHeight);
  const srcX = part === null ? 0 : Math.round(part.x * figure.frameWidth);
  const srcY = part === null ? 0 : Math.round(part.y * figure.frameHeight);
  const cellW = srcW * scale;
  const cellH = srcH * scale;
  const columnsOf = (count: number): number[] => {
    if (frameList.length > 0) return frameList.filter((frame) => frame >= 0 && frame < count);
    return frameFilter === NO_FRAME
      ? Array.from({ length: count }, (_unused, i) => i)
      : [Math.min(count - 1, Math.max(0, frameFilter))];
  };
  const maxCols = Math.max(...states.map((state) => columnsOf(frameCountOf(state)).length));
  const width = PADDING + maxCols * (cellW + PADDING);
  const height = PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING);
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const state of states) {
    const count = frameCountOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      labelOf(state, states.indexOf(state)) + (part === null ? '' : `  [${partName}]`),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    const frames = Array.from({ length: count }, (_unused, frame) =>
      composedCell(state, frame, mode !== 'delta'),
    );
    columnsOf(count).forEach((col, slot) => {
      const x = PADDING + slot * (cellW + PADDING);
      const blit = (frame: number, alpha: number): void => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(frames[frame], srcX, srcY, srcW, srcH, x, y, cellW, cellH);
        ctx.restore();
      };
      if (mode === 'delta') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        blit(col, 1);
        ctx.globalCompositeOperation = 'difference';
        blit((col + count - 1) % count, 1);
        ctx.restore();
      } else {
        if (mode === 'onion') blit((col + count - 1) % count, ONION_ALPHA);
        blit(col, 1);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (part === null) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + figure.tileX * scale,
          y + figure.tileY * scale,
          ROOSTER_TILE_SCALE * scale,
          ROOSTER_TILE_SCALE * scale,
        );
      }
    });
    const row = rowOf(state);
    if (row !== undefined && part === null && mode === 'arc') drawArc(ctx, row, PADDING, y, scale);
    if (row !== undefined && part === null && mode === 'trails')
      drawTrails(ctx, row, PADDING, y, scale);
    y += cellH + PADDING;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode ${mode})`,
  );
}

main();
