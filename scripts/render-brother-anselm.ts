/**
 * Review harness for Brother Anselm, the hireling healer on the human rig:
 * every row he plays, in every view, drawn through the runtime path with his
 * quarterstaff composited between each cell's layers.
 *
 *   npm run render:brother-anselm
 *   npx tsx scripts/render-brother-anselm.ts --rows=mend,cower
 *
 * Writes one sheet per row under `preview/brother-anselm/`: each view large
 * at the bake's own tile (a profile row again facing −X), then the same
 * frames at the 32 px tile on the dungeon floor, and that strip blown up
 * nearest-neighbour so the in-game pixels can be judged.
 *
 * First it re-measures what his sprite freezes off the art — the top of his
 * head over his tile and where his eyes sit — and exits non-zero if either
 * has moved; it prints the measured numbers either way.
 */

import { createCanvas, type Canvas } from 'canvas';
import { join } from 'node:path';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { reportFigureGates } from './figureGates.js';
import { paintFigureCell } from './figureSheet.js';
import {
  FRAME_H,
  FRAME_W,
  HUMAN_ROW_TABLE,
  type HumanRowName,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import { TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import { probeHumanJoints } from '../src/sprites/art/human/probe.js';
import { HEAD_DEPTH, HEAD_RX } from '../src/sprites/art/biped/proportions.js';
import { EYE_DX, PROFILE_EYE_X } from '../src/sprites/art/biped/head.js';
import { drawHumanFigureSelection } from '../src/sprites/humanSprite.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import { BROTHER_ANSELM_LOOK } from '../src/sprites/looks/humans/brotherAnselm.js';
import { ANSELM_QUARTERSTAFF } from '../src/sprites/held/art/quarterstaffHeld.js';
import type { CardinalView } from '../src/sprites/facingView.js';
import type { ViewedEyePlacement } from '../src/sprites/eyePlacement.js';
import {
  ANSELM_EYES,
  ANSELM_HEAD_LIFT_TILES,
  ANSELM_ROWS,
  type AnselmRow,
  BROTHER_ANSELM_FIGURE,
} from '../src/sprites/brotherAnselmSprite.js';

installCanvasGlobals();

const OUT_DIR = join(PREVIEW_DIR, 'brother-anselm');
const ALL_ROWS: readonly AnselmRow[] = [
  'idle',
  'walk',
  'flee',
  'staff_strike',
  'mend',
  'cower',
  'hurt',
  'death',
];
const VIEWS: readonly CardinalView[] = ['front', 'side', 'back'];

const BAKE_TILE = TILE_SCALE;
const SMALL_TILE = 32;
const PIXEL_ZOOM = 3;
const LABEL_HEIGHT = 18;
const LABEL_FONT = '13px sans-serif';
const LABEL_COLOR = '#e8e2d8';
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GAP = 8;
const CELL_TILES_W = FRAME_W / TILE_SCALE;
const CELL_TILES_H = FRAME_H / TILE_SCALE;
const TILE_LEFT_SHARE = TILE_X / TILE_SCALE;
const TILE_TOP_SHARE = TILE_Y / TILE_SCALE;

function flagValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function isAnselmRow(name: string): name is AnselmRow {
  return ALL_ROWS.some((row) => row === name);
}

function chosenRows(): readonly AnselmRow[] {
  const flag = flagValue('rows');
  if (flag === null) return ALL_ROWS;
  const rows = flag.split(',').filter(isAnselmRow);
  if (rows.length === 0) throw new Error(`--rows=${flag} names none of ${ALL_ROWS.join(', ')}`);
  return rows;
}

// ── The frozen measurements ──────────────────────────────────────────────────

const RGBA = 4;
const ALPHA = 3;
const INK = 8;
/** The frozen numbers are kept to two places; a measurement off by more than this has moved. */
const MEASURE_SLACK = 0.02;
/** The head is looked for within this many head half-widths of the head's centre, clear of the staff. */
const HEAD_SEARCH_HALF_WIDTHS = 1.6;
const STANDING_ROWS: readonly HumanRowName[] = [
  'twohand_rest',
  'twohand_rest_side',
  'twohand_rest_away',
];
const DIGITS = 2;

/** The highest ink over the head's columns of a standing frame, in cell pixels; the staff is not in the cell. */
function headTopPx(row: HumanRowName, frame: number): number {
  const probe = probeHumanJoints(row, frame, BROTHER_ANSELM_LOOK);
  const halfWidth = HEAD_RX * HEAD_SEARCH_HALF_WIDTHS * probe.pixelsPerUnit;
  const cell = paintFigureCell(BROTHER_ANSELM_FIGURE.def, row, frame);
  const data = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
  const left = Math.max(0, Math.floor(probe.headCentre.x - halfWidth));
  const right = Math.min(cell.width - 1, Math.ceil(probe.headCentre.x + halfWidth));
  for (let y = 0; y < cell.height; y++) {
    for (let x = left; x <= right; x++) {
      if (data[(y * cell.width + x) * RGBA + ALPHA] > INK) return y;
    }
  }
  return cell.height;
}

function measuredHeadLiftTiles(): number {
  let top = Number.POSITIVE_INFINITY;
  for (const row of STANDING_ROWS) {
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      top = Math.min(top, headTopPx(row, frame));
    }
  }
  return (TILE_Y - top) / TILE_SCALE;
}

function measuredEyes(): Omit<ViewedEyePlacement, 'sideSpacing' | 'frontMirrors'> {
  const tileCentreX = TILE_X + TILE_SCALE / 2;
  const front = probeHumanJoints('twohand_rest', 0, BROTHER_ANSELM_LOOK);
  const side = probeHumanJoints('twohand_rest_side', 0, BROTHER_ANSELM_LOOK);
  const headScale = BROTHER_ANSELM_LOOK.headScale;
  return {
    sideForward:
      (side.headCentre.x +
        HEAD_DEPTH * PROFILE_EYE_X * headScale * side.pixelsPerUnit -
        tileCentreX) /
      TILE_SCALE,
    sideHeight: (side.headCentre.y - TILE_Y) / TILE_SCALE,
    frontAcross: (front.headCentre.x - tileCentreX) / TILE_SCALE,
    frontHeight: (front.headCentre.y - TILE_Y) / TILE_SCALE,
    frontSpacing: (2 * EYE_DX * headScale * front.pixelsPerUnit) / TILE_SCALE,
  };
}

function measurementFailures(): string[] {
  const failures: string[] = [];
  const lift = measuredHeadLiftTiles();
  console.log(`  head lift: ${lift.toFixed(DIGITS)} tiles (frozen ${ANSELM_HEAD_LIFT_TILES})`);
  if (Math.abs(lift - ANSELM_HEAD_LIFT_TILES) > MEASURE_SLACK) {
    failures.push(
      `the top of his head is ${lift.toFixed(DIGITS)} tiles over his tile; ANSELM_HEAD_LIFT_TILES says ${ANSELM_HEAD_LIFT_TILES}`,
    );
  }
  const eyes = measuredEyes();
  for (const field of [
    'sideForward',
    'sideHeight',
    'frontAcross',
    'frontHeight',
    'frontSpacing',
  ] as const) {
    const measured = eyes[field];
    const frozen = ANSELM_EYES[field];
    console.log(`  eyes.${field}: ${measured.toFixed(DIGITS)} (frozen ${frozen})`);
    if (Math.abs(measured - frozen) > MEASURE_SLACK) {
      failures.push(
        `eyes.${field} measures ${measured.toFixed(DIGITS)}; ANSELM_EYES says ${frozen}`,
      );
    }
  }
  return failures;
}

// ── The sheets ───────────────────────────────────────────────────────────────

function strip(row: HumanRowName, tile: number, flipX: boolean, floor: string): Canvas {
  const frames = HUMAN_ROW_TABLE[row].frameCount;
  const cellWidth = CELL_TILES_W * tile;
  const canvas = createCanvas(Math.ceil(cellWidth * frames), Math.ceil(CELL_TILES_H * tile));
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let frame = 0; frame < frames; frame++) {
    beginFigureFrame();
    drawHumanFigureSelection(
      ctx,
      BROTHER_ANSELM_FIGURE,
      frame * cellWidth + TILE_LEFT_SHARE * tile,
      TILE_TOP_SHARE * tile,
      tile,
      { row, frame, flipX },
      { look: ANSELM_QUARTERSTAFF, phase: 0 },
    );
  }
  return canvas;
}

function zoomed(source: Canvas, zoom: number): Canvas {
  const canvas = createCanvas(source.width * zoom, source.height * zoom);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

interface Band {
  readonly label: string;
  readonly image: Canvas;
}

function bandsFor(anselmRow: AnselmRow): Band[] {
  const names = [...new Set(VIEWS.map((view) => ANSELM_ROWS[anselmRow][view]))];
  const bands: Band[] = [];
  for (const row of names) {
    bands.push({ label: `${anselmRow} — ${row}`, image: strip(row, BAKE_TILE, false, BACKDROP) });
    if (HUMAN_ROW_TABLE[row].mirrorable) {
      bands.push({
        label: `${anselmRow} — ${row} facing −X`,
        image: strip(row, BAKE_TILE, true, BACKDROP),
      });
    }
  }
  for (const row of names) {
    const small = strip(row, SMALL_TILE, false, DUNGEON_FLOOR);
    bands.push({ label: `${row} at the 32 px tile`, image: small });
    bands.push({ label: `  (×${PIXEL_ZOOM})`, image: zoomed(small, PIXEL_ZOOM) });
  }
  return bands;
}

function stack(bands: readonly Band[]): Canvas {
  const width = Math.max(...bands.map((band) => band.image.width));
  const height = bands.reduce((sum, band) => sum + LABEL_HEIGHT + band.image.height + GAP, 0);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const band of bands) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(band.label, GAP, y + LABEL_HEIGHT - GAP / 2);
    y += LABEL_HEIGHT;
    ctx.drawImage(band.image, 0, y);
    y += band.image.height + GAP;
  }
  return canvas;
}

console.log('Measuring Brother Anselm…');
if (reportFigureGates('brother anselm', measurementFailures())) {
  for (const row of chosenRows()) {
    const path = writePreviewPng(join(OUT_DIR, `${row}.png`), stack(bandsFor(row)).toBuffer());
    console.log(`  wrote ${path}`);
  }
}
