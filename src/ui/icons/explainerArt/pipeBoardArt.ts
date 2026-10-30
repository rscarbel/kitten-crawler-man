/**
 * Illustrations for the pipe board's explainer, painted with the board's own
 * painter so the lesson looks exactly like the puzzle: water flooding in from
 * the main past a dry branch, a tap turning an elbow so the water runs on, a
 * toilet and sink filling and flipping their tags to green, and a leaking
 * corner beside the same corner fixed.
 */

import type { PipeFixture, PipeTileKind } from '../../../systems/cloggedBathroom/pipeBoard';
import {
  fitPipeBoard,
  paintPipeBoard,
  pipeCellRect,
  quietCellPicture,
  type PipeBoardGeometry,
  type PipeBoardPicture,
  type PipeCellPicture,
  type PipeFixturePicture,
  type PipePuddlePicture,
} from '../../pipeBoard/pipeBoardPainter';
import { pipeInk } from '../../theme/pipeInk';
import { worldText } from '../../world/worldText';
import type { IllustrationRect } from './illustration';
import { WORLD_TICKS_PER_SECOND } from '../../../core/constants';

const N = 1;
const E = 2;
const S = 4;
const W = 8;

const MS_PER_SECOND = 1000;
const MS_PER_FRAME = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;
/** The explainer floods slower than the board does, so the eye can follow it. */
const LESSON_STEP_MS = 260;
const HALF = 0.5;
const ART_MAX_CELL = 80;
const ART_MIN_CELL = 40;

function msOf(frame: number): number {
  return frame * MS_PER_FRAME;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function bandRect(rect: IllustrationRect): { x: number; y: number; w: number; h: number } {
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

interface LessonCell {
  readonly kind: PipeTileKind;
  readonly mask: number;
  /** Flow steps from the main; null for a tile the water never reaches. */
  readonly distance: number | null;
  readonly inflow: number;
  readonly leaks?: number;
  readonly bolted?: boolean;
}

const EMPTY: LessonCell = { kind: 'cap', mask: 0, distance: null, inflow: 0 };

/** A lesson tile with the water `floodMs` into its flood. */
function lessonCell(cell: LessonCell, floodMs: number): PipeCellPicture {
  const base = quietCellPicture(cell.kind, cell.mask, cell.bolted === true);
  if (cell.distance === null) return base;
  const water = clamp01(floodMs / LESSON_STEP_MS - cell.distance);
  const leaks = water >= 1 ? (cell.leaks ?? 0) : 0;
  return {
    ...base,
    water,
    inflow: cell.inflow,
    distance: cell.distance,
    leaks,
    spray: leaks === 0 ? 0 : clamp01((floodMs / LESSON_STEP_MS - cell.distance - 1) * 2),
  };
}

function picture(
  cols: number,
  rows: number,
  cells: readonly PipeCellPicture[],
  fixtures: readonly PipeFixturePicture[],
  puddles: readonly PipePuddlePicture[],
  timeMs: number,
): PipeBoardPicture {
  return {
    cols,
    rows,
    inletRow: 0,
    cells,
    fixtures,
    puddles,
    gauge: null,
    mainSurge: 0,
    timeMs,
  };
}

function fit(
  area: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
  fixtures: readonly PipeFixture[],
): PipeBoardGeometry {
  return fitPipeBoard(
    area,
    { cols, rows, inletRow: 0, fixtures },
    { maxCell: ART_MAX_CELL, minCell: ART_MIN_CELL, gauge: false, tight: fixtures.length === 0 },
  );
}

// ── Page 1: the water main ───────────────────────────────────────────────────

const MAIN_CYCLE_MS = 3600;
const MAIN_FLOOD_FROM_MS = 300;
const MAIN_HOLD_UNTIL_MS = 3300;

/** Row 0 runs wet from the main; the two elbows below never connect, so they stay dry. */
const MAIN_LESSON: readonly LessonCell[] = [
  { kind: 'straight', mask: W | E, distance: 0, inflow: W },
  { kind: 'tee', mask: W | E | S, distance: 1, inflow: W },
  { kind: 'cap', mask: W, distance: 2, inflow: W },
  { kind: 'elbow', mask: E | S, distance: null, inflow: 0 },
  { kind: 'cap', mask: N, distance: 2, inflow: N },
  { kind: 'elbow', mask: W | S, distance: null, inflow: 0 },
];

export function drawPipeMainPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  const ms = msOf(frame);
  const inCycle = ms % MAIN_CYCLE_MS;
  const floodMs = inCycle < MAIN_HOLD_UNTIL_MS ? inCycle - MAIN_FLOOD_FROM_MS : 0;
  const cols = 3;
  const rows = 2;
  const geometry = fit(bandRect(rect), cols, rows, []);
  const cells = MAIN_LESSON.map((cell) => lessonCell(cell, floodMs));
  paintPipeBoard(ctx, geometry, picture(cols, rows, cells, [], [], ms));
}

// ── Page 2: turn the pipes ───────────────────────────────────────────────────

const TURN_CYCLE_MS = 4200;
const POINTER_ARRIVES_MS = 700;
const TAP_AT_MS = 1200;
const TURN_TAKES_MS = 320;
const TURN_HOLD_UNTIL_MS = 3900;
const RIPPLE_MS = 450;
const RIPPLE_RADIUS = 0.45;
const FINGER_RADIUS = 0.17;
const CURSOR_SIZE = 0.42;
const POINTER_START_X = 1.6;
const POINTER_START_Y = 1.4;
const OUTLINE = 2;
const CURSOR_NOTCH_X = 0.27;
const CURSOR_NOTCH_Y = 0.76;
const CURSOR_TAIL_LEFT_X = 0.45;
const CURSOR_TAIL_LEFT_Y = 1.13;
const CURSOR_TAIL_RIGHT_X = 0.6;
const CURSOR_TAIL_RIGHT_Y = 1.06;
const CURSOR_ELBOW_X = 0.42;
const CURSOR_WING_X = 0.72;
const CURSOR_WING_Y = 0.7;
/** The arrow cursor's outline, tip first, in cursor heights. */
const CURSOR_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [CURSOR_NOTCH_X, CURSOR_NOTCH_Y],
  [CURSOR_TAIL_LEFT_X, CURSOR_TAIL_LEFT_Y],
  [CURSOR_TAIL_RIGHT_X, CURSOR_TAIL_RIGHT_Y],
  [CURSOR_ELBOW_X, CURSOR_WING_Y],
  [CURSOR_WING_X, CURSOR_WING_Y],
];

/** Before the turn: the elbow faces away, so the straight's end sprays. */
const ELBOW_BEFORE = E | S;
const ELBOW_AFTER = S | W;

function paintPointer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  touch: boolean,
  tapProgress: number,
): void {
  const ink = pipeInk.explainer;
  ctx.save();
  if (touch) {
    if (tapProgress > 0 && tapProgress < 1) {
      ctx.globalAlpha = 1 - tapProgress;
      ctx.beginPath();
      ctx.arc(x, y, cell * RIPPLE_RADIUS * tapProgress, 0, Math.PI * 2);
      ctx.lineWidth = OUTLINE;
      ctx.strokeStyle = ink.ripple;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(x, y, cell * FINGER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ink.hand;
    ctx.fill();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = ink.handOutline;
    ctx.stroke();
  } else {
    const s = cell * CURSOR_SIZE;
    ctx.beginPath();
    CURSOR_OUTLINE.forEach(([cx, cy], index) => {
      if (index === 0) ctx.moveTo(x + cx * s, y + cy * s);
      else ctx.lineTo(x + cx * s, y + cy * s);
    });
    ctx.closePath();
    ctx.fillStyle = ink.hand;
    ctx.fill();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = ink.handOutline;
    ctx.stroke();
    if (tapProgress > 0 && tapProgress < 1) {
      ctx.globalAlpha = 1 - tapProgress;
      ctx.beginPath();
      ctx.arc(x, y, cell * RIPPLE_RADIUS * tapProgress, 0, Math.PI * 2);
      ctx.strokeStyle = ink.ripple;
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawPipeTurnPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
  touch: boolean,
): void {
  const ms = msOf(frame);
  const inCycle = ms % TURN_CYCLE_MS;
  const held = inCycle < TURN_HOLD_UNTIL_MS;
  const turned = held && inCycle >= TAP_AT_MS;
  const spin = turned ? -clamp01(1 - (inCycle - TAP_AT_MS) / TURN_TAKES_MS) : 0;
  const settledAt = TAP_AT_MS + TURN_TAKES_MS;
  const cols = 2;
  const rows = 2;
  const geometry = fit(bandRect(rect), cols, rows, []);
  const longAgo = LESSON_STEP_MS * cols * rows;
  const straight = lessonCell(
    { kind: 'straight', mask: W | E, distance: 0, inflow: W, leaks: turned && spin === 0 ? 0 : E },
    longAgo,
  );
  const afterFlood = turned && spin === 0 ? inCycle - settledAt : -1;
  const elbow = turned
    ? {
        ...lessonCell({ kind: 'elbow', mask: ELBOW_AFTER, distance: 0, inflow: W }, afterFlood),
        spin,
      }
    : quietCellPicture('elbow', ELBOW_BEFORE, false);
  const cap = lessonCell({ kind: 'cap', mask: N, distance: 1, inflow: N }, afterFlood);
  const cells = [
    straight,
    elbow,
    lessonCell(EMPTY, 0),
    turned ? cap : quietCellPicture('cap', N, false),
  ];
  const puddles: PipePuddlePicture[] =
    turned && spin === 0 ? [] : [{ cell: 0, side: E, size: clamp01(inCycle / TAP_AT_MS) }];
  paintPipeBoard(ctx, geometry, picture(cols, rows, cells, [], puddles, ms));
  const target = pipeCellRect(geometry, 1);
  const tx = target.x + target.w * HALF;
  const ty = target.y + target.h * HALF;
  const approach = clamp01((inCycle - POINTER_ARRIVES_MS) / (TAP_AT_MS - POINTER_ARRIVES_MS));
  const startX = target.x + target.w * POINTER_START_X;
  const startY = target.y + target.h * POINTER_START_Y;
  const px = startX + (tx - startX) * approach;
  const py = startY + (ty - startY) * approach;
  const tapProgress = (inCycle - TAP_AT_MS) / RIPPLE_MS;
  if (inCycle >= POINTER_ARRIVES_MS && held) {
    paintPointer(ctx, px, py, geometry.cell, touch, tapProgress);
  }
}

// ── Page 3: fill every fixture ───────────────────────────────────────────────

const FILL_CYCLE_MS = 4200;
const FILL_FLOOD_FROM_MS = 900;
const FILL_HOLD_UNTIL_MS = 3900;
const FIXTURE_FILL_MS = 380;
const FIXTURE_PULSE_MS = 600;

const FILL_FIXTURES: readonly PipeFixture[] = [
  { edge: 'top', index: 1, kind: 'toilet' },
  { edge: 'right', index: 0, kind: 'sink' },
];

function fixturePictures(
  fixtures: readonly PipeFixture[],
  fullFromMs: readonly (number | null)[],
  ms: number,
): PipeFixturePicture[] {
  return fixtures.map((fixture, index) => {
    const from = fullFromMs[index] ?? null;
    if (from === null) return { fixture, full: 0, pulse: 0 };
    const full = clamp01((ms - from) / FIXTURE_FILL_MS);
    const pulse = (ms - from - FIXTURE_FILL_MS) / FIXTURE_PULSE_MS;
    return { fixture, full, pulse: pulse > 0 && pulse < 1 ? pulse : 0 };
  });
}

export function drawPipeFixturesPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  const ms = msOf(frame);
  const inCycle = ms % FILL_CYCLE_MS;
  const floodMs = inCycle < FILL_HOLD_UNTIL_MS ? inCycle - FILL_FLOOD_FROM_MS : -1;
  const cols = 2;
  const rows = 1;
  const geometry = fit(bandRect(rect), cols, rows, FILL_FIXTURES);
  const cells = [
    lessonCell({ kind: 'straight', mask: W | E, distance: 0, inflow: W }, floodMs),
    lessonCell({ kind: 'tee', mask: W | N | E, distance: 1, inflow: W }, floodMs),
  ];
  const fullAt = floodMs < 0 ? null : FILL_FLOOD_FROM_MS + LESSON_STEP_MS * cols;
  const fixtures = fixturePictures(FILL_FIXTURES, [fullAt, fullAt], inCycle);
  paintPipeBoard(ctx, geometry, picture(cols, rows, cells, fixtures, [], ms));
}

// ── Page 4: no leaks ─────────────────────────────────────────────────────────

const CAPTION_SIZE = 13;
const CAPTION_GAP = 4;
const LEAK_CAPTION = 'Leaking';
const FIXED_CAPTION = 'Fixed';
const PANEL_GAP_SHARE = 0.04;

export function drawPipeLeaksPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  const ms = msOf(frame);
  const longAgo = Number.MAX_SAFE_INTEGER;
  const gap = rect.width * PANEL_GAP_SHARE;
  const halfW = (rect.width - gap) / 2;
  const captionH = CAPTION_SIZE + CAPTION_GAP;
  const cols = 2;
  const rows = 1;
  const halves = [
    { x: rect.x, caption: LEAK_CAPTION, leaking: true },
    { x: rect.x + halfW + gap, caption: FIXED_CAPTION, leaking: false },
  ];
  for (const half of halves) {
    const area = { x: half.x, y: rect.y, w: halfW, h: rect.height - captionH };
    const geometry = fit(area, cols, rows, FILL_FIXTURES);
    const teeMask = half.leaking ? W | N | S : W | N | E;
    const cells = [
      lessonCell({ kind: 'straight', mask: W | E, distance: 0, inflow: W }, longAgo),
      lessonCell(
        { kind: 'tee', mask: teeMask, distance: 1, inflow: W, leaks: half.leaking ? S : 0 },
        longAgo,
      ),
    ];
    const fixtures: PipeFixturePicture[] = [
      { fixture: FILL_FIXTURES[0], full: 1, pulse: 0 },
      { fixture: FILL_FIXTURES[1], full: half.leaking ? 0 : 1, pulse: 0 },
    ];
    const puddles: PipePuddlePicture[] = half.leaking ? [{ cell: 1, side: S, size: 1 }] : [];
    paintPipeBoard(ctx, geometry, picture(cols, rows, cells, fixtures, puddles, ms));
    worldText(ctx, half.caption, {
      x: half.x + halfW / 2,
      y: geometry.frame.y + geometry.frame.h + CAPTION_GAP,
      size: CAPTION_SIZE,
      bold: true,
      color: pipeInk.explainer.caption,
      align: 'center',
    });
  }
}
