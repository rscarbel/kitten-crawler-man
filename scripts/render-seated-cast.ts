#!/usr/bin/env tsx
/**
 * Review harness for the club cast's seated rows: every seat pose in every
 * view, for Hawkfolk and human looks, each sitter on a bar stool drawn on the
 * same tile the way the club draws a gambler.
 *
 *   preview/seated-cast/sheet-6x.png   one look per row, pose × view, at 6×
 *   preview/seated-cast/sheet-3x.png   the same at 3×
 *   preview/seated-cast/ingame.png     the same at the 32 px tile, on club floor
 *   preview/seated-cast/strip-<pose>-<view>.png  every frame of a pose in a view, 2× cell
 *
 *   npm run render:seated-cast
 *
 * The seated gates run first, over the subjects drawn here.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, frameCountOf } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import { reportFigureGates } from './figureGates.js';
import {
  barStoolSeatFailures,
  seatedFigureFailures,
  seatedSeamFailures,
} from './seatedCastGates.js';
import { TILE_SIZE } from '../src/core/constants.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { CLUB_TILE_SCALE, drawBarStool } from '../src/sprites/art/clubFurnitureArt.js';
import {
  SEAT_POSES,
  SEAT_VIEWS,
  seatStateName,
  type SeatPose,
  type SeatView,
} from '../src/sprites/art/seatPoses.js';
import { clubSeatedFigure, type ClubFigureRef } from '../src/sprites/clubCastFigure.js';
import { townCastLook } from '../src/sprites/person/townCastLooks.js';

const OUT_DIR = `${PREVIEW_DIR}/seated-cast`;
const BACKDROP = '#2a2230';
const FLOOR = '#4a3a44';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
const LABEL_HEIGHT = 16;
const PADDING = 6;
/** How far a label's baseline sits above the bottom of its band. */
const LABEL_BASELINE_LIFT = 4;
const LABEL_INSET = 2;
/** Headroom above the stool's tile a seated figure's art may rise into, in tiles. */
const CARD_HEADROOM_TILES = 2.2;
const CARD_FOOT_TILES = 0.4;
const CARD_WIDTH_TILES = 2.2;
const STOOL_HEADROOM_TILES = 0.5;
/** Which frame of each pose the sheet shows: the held extreme of the motion. */
const SHEET_FRAME: Readonly<Record<SeatPose, number>> = {
  idle: 0,
  play: 4,
  cheer: 5,
  slump: 6,
};

const SUBJECTS: ReadonlyArray<{ label: string; ref: ClubFigureRef }> = [
  {
    label: 'hawkfolk merchant',
    ref: { species: 'hawkfolk', lookId: 'merchant_sparrowfleck_slight' },
  },
  {
    label: 'hawkfolk noble heavy',
    ref: { species: 'hawkfolk', lookId: 'noble_goldenbarred_heavy' },
  },
  { label: 'human smith', ref: { species: 'human', look: townCastLook('adult_smith') } },
  { label: 'human noble', ref: { species: 'human', look: townCastLook('adult_noble') } },
];

function stoolCell(): Canvas {
  const headroom = CLUB_TILE_SCALE * STOOL_HEADROOM_TILES;
  const canvas = createCanvas(CLUB_TILE_SCALE, CLUB_TILE_SCALE + headroom);
  const ctx = canvas.getContext('2d');
  drawBarStool(
    asGameContext(ctx),
    { w: CLUB_TILE_SCALE, h: canvas.height, footTop: headroom, footBottom: canvas.height },
    0,
    0,
  );
  return canvas;
}

const STOOL = stoolCell();

/** Draws stool and sitter with the tile's top-left at `tx`,`ty`, `scale` screen px per cell px. */
function drawSeated(
  ctx: NodeCtx,
  def: FigureDef,
  state: string,
  frame: number,
  tx: number,
  ty: number,
  scale: number,
  flip: boolean,
): void {
  const stoolHeadroom = STOOL.height - CLUB_TILE_SCALE;
  ctx.drawImage(STOOL, tx, ty - stoolHeadroom * scale, STOOL.width * scale, STOOL.height * scale);
  const cell = bakeFigureCell(def, state, frame);
  const k = (scale * CLUB_TILE_SCALE) / def.tileScale;
  ctx.save();
  if (flip) {
    ctx.translate(tx + CLUB_TILE_SCALE * scale, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cell, -def.tileX * k, ty - def.tileY * k, cell.width * k, cell.height * k);
  } else {
    ctx.drawImage(cell, tx - def.tileX * k, ty - def.tileY * k, cell.width * k, cell.height * k);
  }
  ctx.restore();
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
}

interface Column {
  readonly pose: SeatPose;
  readonly view: SeatView;
}

const COLUMNS: readonly Column[] = SEAT_POSES.flatMap((pose) =>
  SEAT_VIEWS.map((view) => ({ pose, view })),
);

function sheet(scale: number, tilePx: number, frameOf: (pose: SeatPose) => number): Canvas {
  const tile = tilePx * scale;
  const cardW = tile * CARD_WIDTH_TILES;
  const cardH = tile * (1 + CARD_HEADROOM_TILES + CARD_FOOT_TILES);
  const canvas = createCanvas(
    PADDING + COLUMNS.length * (cardW + PADDING),
    LABEL_HEIGHT + SUBJECTS.length * (cardH + LABEL_HEIGHT + PADDING),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cellScale = tilePx / CLUB_TILE_SCALE;
  ctx.imageSmoothingEnabled = scale * cellScale < 1;
  SUBJECTS.forEach((subject, row) => {
    const top = LABEL_HEIGHT + row * (cardH + LABEL_HEIGHT + PADDING);
    label(ctx, subject.label, PADDING, top + LABEL_HEIGHT - LABEL_BASELINE_LIFT);
    const def = seatedFigureFor(subject.ref);
    COLUMNS.forEach((column, col) => {
      const left = PADDING + col * (cardW + PADDING);
      const cardTop = top + LABEL_HEIGHT;
      ctx.fillStyle = FLOOR;
      ctx.fillRect(left, cardTop, cardW, cardH);
      if (row === 0)
        label(ctx, `${column.pose} ${column.view}`, left, LABEL_HEIGHT - LABEL_BASELINE_LIFT);
      const tx = left + (cardW - tile) / 2;
      const ty = cardTop + tile * CARD_HEADROOM_TILES;
      const state = seatStateName(column.pose, column.view);
      const frames = frameCountOf(def, state);
      drawSeated(
        ctx,
        def,
        state,
        Math.min(frameOf(column.pose), frames - 1),
        tx,
        ty,
        scale * cellScale,
        false,
      );
    });
  });
  return canvas;
}

function strip(pose: SeatPose, view: SeatView, scale: number): Canvas {
  const tile = CLUB_TILE_SCALE * scale;
  const cardW = tile * CARD_WIDTH_TILES;
  const cardH = tile * (1 + CARD_HEADROOM_TILES + CARD_FOOT_TILES);
  const defs = SUBJECTS.map((subject) => seatedFigureFor(subject.ref));
  const state = seatStateName(pose, view);
  const frames = frameCountOf(defs[0], state);
  const canvas = createCanvas(
    PADDING + frames * (cardW + PADDING),
    SUBJECTS.length * (cardH + PADDING) + PADDING,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  defs.forEach((def, row) => {
    const top = PADDING + row * (cardH + PADDING);
    for (let frame = 0; frame < frames; frame++) {
      const left = PADDING + frame * (cardW + PADDING);
      ctx.fillStyle = FLOOR;
      ctx.fillRect(left, top, cardW, cardH);
      label(ctx, String(frame), left + LABEL_INSET, top + LABEL_HEIGHT - LABEL_BASELINE_LIFT);
      drawSeated(
        ctx,
        def,
        state,
        frame,
        left + (cardW - tile) / 2,
        top + tile * CARD_HEADROOM_TILES,
        scale,
        false,
      );
    }
  });
  return canvas;
}

const SHEET_6X = 6;
const SHEET_3X = 3;
const STRIP_SCALE = 2;

function seatedFigureFor(ref: ClubFigureRef): FigureDef {
  const figure = clubSeatedFigure(ref);
  if (figure === undefined) throw new Error('a review subject has no seated figure');
  return figure;
}

function main(): void {
  const subjectDefs = SUBJECTS.map((subject) => seatedFigureFor(subject.ref));
  const gateFailures = [
    ...barStoolSeatFailures(),
    ...subjectDefs.flatMap((def) => [...seatedFigureFailures(def), ...seatedSeamFailures(def)]),
  ];
  if (!reportFigureGates('seated-cast', gateFailures)) return;
  const written: string[] = [];
  const write = (name: string, canvas: Canvas): void => {
    written.push(writePreviewPng(`${OUT_DIR}/${name}`, canvas.toBuffer('image/png')));
  };
  const heldFrame = (pose: SeatPose): number => SHEET_FRAME[pose];
  write('sheet-6x.png', sheet(SHEET_6X, TILE_SIZE, heldFrame));
  write('sheet-3x.png', sheet(SHEET_3X, TILE_SIZE, heldFrame));
  write('ingame.png', sheet(1, TILE_SIZE, heldFrame));
  for (const pose of SEAT_POSES) {
    for (const view of SEAT_VIEWS)
      write(`strip-${pose}-${view}.png`, strip(pose, view, STRIP_SCALE));
  }
  for (const path of written) console.log(path);
}

main();
