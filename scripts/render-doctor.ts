#!/usr/bin/env tsx
/**
 * Review harness for the safe-room doctor (`src/sprites/art/doctorFigure.ts`).
 *
 * Writes:
 *   <out>/doctor-rows.png    every frame of every row for a few rooms' doctors, at the cell's own size (2x the game)
 *   <out>/doctor-lineup.png  many rooms' doctors side by side, idle, at the game's 32 px tile and blown up 4x
 *   <out>/doctor-ingame.png  every row's key frames for many rooms' doctors at 32 px, blown up 4x
 *   <out>/doctor-closeup.png one frame of each row for the first room's doctor, at 3x the cell
 *
 * and prints how far above the top of the tile the highest standing ink
 * reaches at 32 px, the measurement `DOCTOR_HEAD_TOP_ABOVE_TILE_PX` freezes.
 *
 *   npm run render:doctor
 *   npx tsx scripts/render-doctor.ts --out=preview/doctor --rooms=8
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { frameCountOf, paintFigureCell } from './figureSheet.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  DOCTOR_ACTIONS,
  DOCTOR_HEAD_TOP_ABOVE_TILE_PX,
  type DoctorAction,
  type DoctorLook,
  doctorFigure,
  doctorLookForRoom,
} from '../src/sprites/art/doctorFigure.js';
import { safeRoomIdIn, type SafeRoomScope } from '../src/map/safeRoomId.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

function flagValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? fallback : arg.slice(prefix.length);
}

const OUT_DIR = flagValue('out', `${PREVIEW_DIR}/doctor`);
const ROOM_COUNT = Number(flagValue('rooms', '8'));
const FIRST_ROOM = Number(flagValue('first', '0'));
/** How many rooms' doctors the full-size row sheet shows; it is wide. */
const ROW_SHEET_ROOMS = Number(flagValue('row-rooms', '2'));
/** The map whose safe rooms the doctors are drawn from; rooms on one map are neighbours in every trait. */
const PREVIEW_SCOPE = { kind: 'floor', level: 'level1' } as const satisfies SafeRoomScope;

const BACKDROP = '#2f2a2e';
/** A mid-dark stone floor: the white coat and the dark clothes both have to part from it. */
const FLOOR = '#4a4540';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
const LABEL_HEIGHT = 16;
const PADDING = 8;
const PIXEL_ZOOM = 4;
const TILE_GUIDE = 'rgba(120, 200, 255, 0.5)';
const SOLID_ALPHA = 128;
const ALPHA_CHANNEL = 3;
const BYTES_PER_PIXEL = 4;

/** The bake density the game draws its 32 px tile at. */
function inGameDensity(def: FigureDef): number {
  return TILE_SIZE / def.tileScale;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function lookOf(room: number): DoctorLook {
  return doctorLookForRoom(safeRoomIdIn(PREVIEW_SCOPE, room));
}

function rooms(): number[] {
  return Array.from({ length: ROOM_COUNT }, (_unused, i) => FIRST_ROOM + i);
}

// ── Rows at the cell's own size ──────────────────────────────────────────────

function renderRows(): Canvas {
  const shown = rooms().slice(0, ROW_SHEET_ROOMS);
  const sample = doctorFigure(lookOf(shown[0]));
  const columns = Math.max(...DOCTOR_ACTIONS.map((action) => frameCountOf(sample, action)));
  const blockH = LABEL_HEIGHT + sample.frameHeight + PADDING;
  const canvas = createCanvas(
    PADDING + columns * (sample.frameWidth + PADDING),
    PADDING + shown.length * DOCTOR_ACTIONS.length * blockH,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = PADDING;
  for (const room of shown) {
    const look = lookOf(room);
    const def = doctorFigure(look);
    for (const action of DOCTOR_ACTIONS) {
      const frames = frameCountOf(def, action);
      label(ctx, `room ${room} — ${action} (${frames} frames) — ${look.id}`, PADDING, y);
      y += LABEL_HEIGHT;
      for (let frame = 0; frame < frames; frame++) {
        const x = PADDING + frame * (def.frameWidth + PADDING);
        ctx.fillStyle = FLOOR;
        ctx.fillRect(x, y, def.frameWidth, def.frameHeight);
        ctx.drawImage(paintFigureCell(def, action, frame), x, y);
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(x + def.tileX, y + def.tileY, def.tileScale, def.tileScale);
      }
      y += def.frameHeight + PADDING;
    }
  }
  return canvas;
}

// ── At the game's size ───────────────────────────────────────────────────────

interface Shot {
  readonly room: number;
  readonly action: DoctorAction;
  readonly frame: number;
}

/** Draws one cell at the game's density, once at 1x and once blown up pixel for pixel. */
function drawInGame(ctx: NodeCtx, shot: Shot, x: number, y: number, smallH: number): number {
  const def = doctorFigure(lookOf(shot.room));
  const cell = paintFigureCell(def, shot.action, shot.frame, inGameDensity(def));
  ctx.drawImage(cell, x, y);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cell, x, y + smallH + PADDING, cell.width * PIXEL_ZOOM, cell.height * PIXEL_ZOOM);
  ctx.imageSmoothingEnabled = true;
  return cell.width * PIXEL_ZOOM;
}

function renderShots(lines: readonly (readonly Shot[])[], captions: readonly string[]): Canvas {
  const def = doctorFigure(lookOf(FIRST_ROOM));
  const density = inGameDensity(def);
  const smallW = Math.ceil(def.frameWidth * density);
  const smallH = Math.ceil(def.frameHeight * density);
  const columns = Math.max(...lines.map((line) => line.length));
  const lineH = LABEL_HEIGHT + smallH + PADDING + smallH * PIXEL_ZOOM + PADDING;
  const canvas = createCanvas(
    PADDING + columns * (smallW * PIXEL_ZOOM + PADDING),
    PADDING + lines.length * lineH,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  lines.forEach((line, row) => {
    const top = PADDING + row * lineH;
    label(ctx, captions[row], PADDING, top);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(PADDING, top + LABEL_HEIGHT, canvas.width - PADDING * 2, smallH);
    ctx.fillRect(
      PADDING,
      top + LABEL_HEIGHT + smallH + PADDING,
      canvas.width - PADDING * 2,
      smallH * PIXEL_ZOOM,
    );
    line.forEach((shot, column) => {
      const x = PADDING + column * (smallW * PIXEL_ZOOM + PADDING);
      drawInGame(ctx, shot, x, top + LABEL_HEIGHT, smallH);
    });
  });
  return canvas;
}

function renderLineup(): Canvas {
  const idle = rooms().map((room): Shot => ({ room, action: 'idle', frame: 0 }));
  return renderShots([idle], [`rooms ${FIRST_ROOM}–${FIRST_ROOM + ROOM_COUNT - 1}, idle`]);
}

/** A row's frames worth seeing at the game's size: an even spread through it. */
const KEY_FRAMES_PER_ROW = 6;

function keyFrames(def: FigureDef, action: DoctorAction): number[] {
  const frames = frameCountOf(def, action);
  const count = Math.min(frames, KEY_FRAMES_PER_ROW);
  return Array.from({ length: count }, (_unused, i) =>
    Math.round((i * (frames - 1)) / Math.max(1, count - 1)),
  );
}

function renderInGame(): Canvas {
  const lines: Shot[][] = [];
  const captions: string[] = [];
  for (const action of DOCTOR_ACTIONS) {
    for (const room of rooms().slice(0, ROW_SHEET_ROOMS + 1)) {
      const def = doctorFigure(lookOf(room));
      const frames = keyFrames(def, action);
      lines.push(frames.map((frame): Shot => ({ room, action, frame })));
      captions.push(`room ${room} — ${action}, frames ${frames.join(', ')}`);
    }
  }
  return renderShots(lines, captions);
}

// ── Close-ups ────────────────────────────────────────────────────────────────

/** Past the cell's own density, for reading the parts: the clipboard, the stethoscope, the hands. */
const CLOSEUP_DENSITY = 3;

/** The first room's doctor, one panel per row, each at a frame from the middle of it. */
function renderCloseup(): Canvas {
  const def = doctorFigure(lookOf(FIRST_ROOM));
  const width = def.frameWidth * CLOSEUP_DENSITY;
  const height = def.frameHeight * CLOSEUP_DENSITY;
  const canvas = createCanvas(width * DOCTOR_ACTIONS.length, height + LABEL_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  DOCTOR_ACTIONS.forEach((action, i) => {
    const frames = frameCountOf(def, action);
    const frame = Math.floor(frames * CLOSEUP_FRAME_SHARE[action]);
    label(ctx, `${action} frame ${frame}`, i * width + PADDING, 0);
    ctx.drawImage(paintFigureCell(def, action, frame, CLOSEUP_DENSITY), i * width, LABEL_HEIGHT);
  });
  return canvas;
}

/** Where through each row its close-up is taken: the moment the row is about. */
const CLOSEUP_FRAME_SHARE: Readonly<Record<DoctorAction, number>> = {
  idle: 0,
  writing: 0.3,
  sorting: 0.5,
  treat: 0.55,
};

// ── Head top ─────────────────────────────────────────────────────────────────

/** The standing rows a marker over the head is hung for: the reach of the sorting row is not the head. */
const STANDING_ACTIONS: readonly DoctorAction[] = ['idle', 'writing'];

function inkTopRow(cell: Canvas): number {
  const ctx = cell.getContext('2d');
  const data = ctx.getImageData(0, 0, cell.width, cell.height).data;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (data[(y * cell.width + x) * BYTES_PER_PIXEL + ALPHA_CHANNEL] >= SOLID_ALPHA) return y;
    }
  }
  return cell.height;
}

function measureHeadTop(): number {
  let highest = 0;
  for (const room of rooms()) {
    const def = doctorFigure(lookOf(room));
    const density = inGameDensity(def);
    const tileTop = def.tileY * density;
    for (const action of STANDING_ACTIONS) {
      for (let frame = 0; frame < frameCountOf(def, action); frame++) {
        const top = inkTopRow(paintFigureCell(def, action, frame, density));
        highest = Math.max(highest, tileTop - top);
      }
    }
  }
  return Math.ceil(highest);
}

function main(): void {
  const outputs: readonly (readonly [string, () => Canvas])[] = [
    ['doctor-rows.png', renderRows],
    ['doctor-lineup.png', renderLineup],
    ['doctor-ingame.png', renderInGame],
    ['doctor-closeup.png', renderCloseup],
  ];
  for (const [name, render] of outputs) {
    const canvas = render();
    const written = writePreviewPng(`${OUT_DIR}/${name}`, canvas.toBuffer('image/png'));
    console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px)`);
  }
  const measured = measureHeadTop();
  const verdict = measured === DOCTOR_HEAD_TOP_ABOVE_TILE_PX ? 'matches' : 'DIFFERS from';
  console.log(
    `head top: ${measured} px above the tile at 32 px; ${verdict} DOCTOR_HEAD_TOP_ABOVE_TILE_PX (${DOCTOR_HEAD_TOP_ABOVE_TILE_PX})`,
  );
}

main();
