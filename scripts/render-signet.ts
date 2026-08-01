/**
 * Headless renderer for Tsarina Signet — the sprite as pixels, without a
 * browser.
 *
 * The browser harness cannot drive this project (a hidden tab never clears the
 * level-intro banner and never runs `requestAnimationFrame`), so the art has to
 * be judgeable from a still. This runs the real draw function through
 * node-canvas and writes a contact sheet: each pose at review scale, a walk
 * strip, and the in-game tile size beside it.
 *
 *   npx tsx scripts/render-signet.ts --out=signet.png --scale=2
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';

import type { SignetPose } from '../src/sprites/signetSprite';

const { drawSignetSprite, drawEliteMarker, SIGNET_OVERLAY_CLEARANCE, SIGNET_HALF_WIDTH } =
  await import('../src/sprites/signetSprite');

const DEFAULT_REVIEW_TILE_SIZE = 220;
const WALK_TILE_SIZE = 120;
const IN_GAME_TILE_SIZE = 32;

const CELL_PAD = 12;
const LABEL_BAND = 18;
/**
 * Signet is drawn at double tile scale and reaches well past her tile on every
 * axis, so cells are sized from the sprite module's own exports rather than
 * from copies of its geometry that would silently drift out of step.
 */
/** The @32 row's labels are far wider than a 32px tile; pitch the row to fit them. */
const GAME_ROW_LABEL_PITCH = 130;
const SHEET_MARGIN = 24;
const SECTION_GAP = 26;

const BG = '#1b2436';
const LABEL_COLOR = '#e2e8f0';
const LABEL_FONT = 'bold 13px sans-serif';

const DEFAULT_SCALE = 2;
const DEFAULT_OUT = 'signet.png';

const WALK_STRIP_FRAMES = 6;
const RADIANS_PER_TURN = Math.PI * 2;

const POSES: ReadonlyArray<{ label: string; pose: SignetPose }> = [
  {
    label: 'idle',
    pose: {
      walkFrame: 0,
      isMoving: false,
      summonProgress: 0,
      castProgress: 0,
      facingX: 1,
      facingAway: false,
    },
  },
  {
    label: 'walking',
    pose: {
      walkFrame: 1.2,
      isMoving: true,
      summonProgress: 0,
      castProgress: 0,
      facingX: 1,
      facingAway: false,
    },
  },
  {
    label: 'casting',
    pose: {
      walkFrame: 0,
      isMoving: false,
      summonProgress: 0,
      castProgress: 0.5,
      facingX: 1,
      facingAway: false,
    },
  },
  {
    label: 'summoning',
    pose: {
      walkFrame: 0,
      isMoving: false,
      summonProgress: 0.5,
      castProgress: 0,
      facingX: 1,
      facingAway: false,
    },
  },
  {
    label: 'facing left',
    pose: {
      walkFrame: 0,
      isMoving: false,
      summonProgress: 0,
      castProgress: 0,
      facingX: -1,
      facingAway: false,
    },
  },
  {
    label: 'facing away',
    pose: {
      walkFrame: 0,
      isMoving: false,
      summonProgress: 0,
      castProgress: 0,
      facingX: 1,
      facingAway: true,
    },
  },
  {
    label: 'walking away',
    pose: {
      walkFrame: 1.2,
      isMoving: true,
      summonProgress: 0,
      castProgress: 0,
      facingX: 1,
      facingAway: true,
    },
  },
];

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + 3);
}

const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);
/** `--tile` blows the review row up when a detail needs judging close in. */
const REVIEW_TILE_SIZE = intArg('tile', DEFAULT_REVIEW_TILE_SIZE);

function markerHeadroom(ts: number): number {
  return Math.ceil(ts * SIGNET_OVERLAY_CLEARANCE);
}

/** Width a cell needs for her widest pose, both arms outstretched. */
function figureWidth(ts: number): number {
  return Math.ceil(ts * SIGNET_HALF_WIDTH * 2);
}

function drawCell(
  ctx: import('canvas').CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cellWidth: number,
  ts: number,
  pose: SignetPose,
  label: string,
): void {
  // Her reach is wider than her tile, so the tile is centred in the cell —
  // drawing at the cell's left edge pushes her arms into the next column.
  const tileX = originX + (cellWidth - ts) / 2;
  drawSignetSprite(ctx, tileX, originY, ts, pose);
  drawEliteMarker(ctx, tileX, originY, ts);

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(label, originX + cellWidth / 2, originY + ts + LABEL_BAND);
  ctx.textAlign = 'left';
}

const reviewHeadroom = markerHeadroom(REVIEW_TILE_SIZE);
const walkHeadroom = markerHeadroom(WALK_TILE_SIZE);
const gameHeadroom = markerHeadroom(IN_GAME_TILE_SIZE);

const reviewCellWidth = figureWidth(REVIEW_TILE_SIZE) + CELL_PAD;
const reviewCellHeight = REVIEW_TILE_SIZE + CELL_PAD + LABEL_BAND + reviewHeadroom;
const walkCellWidth = figureWidth(WALK_TILE_SIZE) + CELL_PAD;
const walkCellHeight = WALK_TILE_SIZE + CELL_PAD + LABEL_BAND + walkHeadroom;
const gameCellWidth = Math.max(figureWidth(IN_GAME_TILE_SIZE) + CELL_PAD, GAME_ROW_LABEL_PITCH);
const gameCellHeight = IN_GAME_TILE_SIZE + CELL_PAD + LABEL_BAND + gameHeadroom;

const sheetWidth =
  SHEET_MARGIN * 2 +
  Math.max(
    POSES.length * reviewCellWidth,
    WALK_STRIP_FRAMES * walkCellWidth,
    POSES.length * gameCellWidth,
  );
const sheetHeight =
  SHEET_MARGIN * 2 + reviewCellHeight + SECTION_GAP + walkCellHeight + SECTION_GAP + gameCellHeight;

const canvas = createCanvas(sheetWidth * scale, sheetHeight * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
ctx.fillStyle = BG;
ctx.fillRect(0, 0, sheetWidth, sheetHeight);

POSES.forEach(({ label, pose }, index) => {
  drawCell(
    ctx,
    SHEET_MARGIN + index * reviewCellWidth,
    SHEET_MARGIN + reviewHeadroom,
    reviewCellWidth,
    REVIEW_TILE_SIZE,
    pose,
    label,
  );
});

const walkRowTop = SHEET_MARGIN + reviewCellHeight + SECTION_GAP;
for (let i = 0; i < WALK_STRIP_FRAMES; i++) {
  const walkFrame = (i / WALK_STRIP_FRAMES) * RADIANS_PER_TURN;
  drawCell(
    ctx,
    SHEET_MARGIN + i * walkCellWidth,
    walkRowTop + walkHeadroom,
    walkCellWidth,
    WALK_TILE_SIZE,
    {
      walkFrame,
      isMoving: true,
      summonProgress: 0,
      castProgress: 0,
      facingX: 1,
      facingAway: false,
    },
    `walk ${i}`,
  );
}

const gameRowTop = walkRowTop + walkCellHeight + SECTION_GAP;
POSES.forEach(({ label, pose }, index) => {
  drawCell(
    ctx,
    SHEET_MARGIN + index * gameCellWidth,
    gameRowTop + gameHeadroom,
    gameCellWidth,
    IN_GAME_TILE_SIZE,
    pose,
    `${label} @32`,
  );
});

writeFileSync(outPath, canvas.toBuffer('image/png'));
process.stdout.write(`wrote ${outPath} (${sheetWidth * scale}x${sheetHeight * scale})\n`);
