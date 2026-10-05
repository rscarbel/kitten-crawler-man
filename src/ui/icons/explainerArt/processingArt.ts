/**
 * Illustrations for the processing explainer: the saw, the rope walk and
 * Fenna's paid batch, drawn with the village's own baked art.
 */

import type { IllustrationRect } from './illustration';
import { getSpriteDefByKey } from '../../../core/SpriteLoader';
import { drawSprite } from '../../../core/SpriteRenderer';
import { BUILD_ROWS, HUMAN_FIGURE, humanRowOf } from '../../../sprites/art/humanFigure';
import { drawFigureCached } from '../../../sprites/figure/figureFrameCache';
import {
  IRON,
  type OverlayAnchor,
  type VillageStandingPropId,
} from '../../../sprites/art/villageArt';
import { villagePropSheetKey } from '../../../sprites/sheets/villageSheets';
import {
  BOARDS_PER_WOOD,
  FENNA_FEE_PER_WOOD,
  MANUAL_PROCESS_SECONDS,
  ROPE_PER_WOOD,
} from '../../../systems/briarHollow/services/woodProcessing';
import { worldText } from '../../world/worldText';
import type { Rect } from '../../core/geom';
import { drawResourceIcon } from '../resourceIcons';

// ── Shared stage ────────────────────────────────────────────────────────────

/**
 * Kept small next to the other explainers' `STAGE_TILE`s: the sawmill's own
 * sheet stands five tiles tall (its footprint plus the sheet's headroom), and
 * a larger tile size would run its roof off the top of the band.
 */
const STAGE_TILE = 40;
const GROUND_FRACTION = 0.9;
const GROUND_FILL = '#2b3a22';
const GROUND_EDGE = '#3c5230';
const GROUND_EDGE_PX = 2;

/** Where the machine's left (anchor) tile sits, as a share of the band's width. */
const STATION_LEFT_SHARE = 0.52;
/** Where the crawler stands to work it, in tiles left of the station's anchor tile. */
const WORKER_OFFSET_TILES = 1.15;
const WORKER_ROW = BUILD_ROWS.side;
/** Frames per pose frame in the illustration: the same steady pace every other page's loop uses. */
const WORK_TICKS_PER_FRAME = 6;

const UPDATES_PER_SECOND = 60;
/** How long the wood sits at the machine, matching the real machine's own per-wood time. */
const WORK_FRAMES = Math.round(MANUAL_PROCESS_SECONDS * UPDATES_PER_SECOND);
/** How long the log takes to slide in from off-band before the work starts. */
const ENTER_FRAMES = 26;
/** How long the "-1 Wood, +N output" pop takes to rise and fade once the work ends. */
const POP_FRAMES = 46;
/** The quiet beat between one log finishing and the next one entering. */
const PAUSE_FRAMES = 22;
const CYCLE_FRAMES = ENTER_FRAMES + WORK_FRAMES + POP_FRAMES + PAUSE_FRAMES;

const LOG_ICON_SIZE = 30;
const OUTPUT_ICON_SIZE = 26;
const POP_RISE_PX = 30;
const POP_TEXT_SIZE = 13;
const POP_COLOR = '#4ade80';
const CONSUMED_COLOR = '#f87171';
const LABEL_TEXT_SIZE = 11;
const LABEL_COLOR = '#e2e8f0';
const LABEL_GAP = 6;
/** How far into the work phase the "-1 Wood" notice appears — just before the log is spent. */
const CONSUMED_NOTICE_AT_PROGRESS = 0.94;
/** Where the fed log and the working figure's hands line up, above the ground line. */
const FEED_HEIGHT_TILES = 0.55;
/** How far left of the station's anchor tile the crawler stands to work it. */
const FEED_OFFSET_TILES = 0.5;

function groundY(rect: IllustrationRect): number {
  return rect.y + rect.height * GROUND_FRACTION;
}

function drawGround(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const top = groundY(rect);
  ctx.fillStyle = GROUND_FILL;
  ctx.fillRect(rect.x, top, rect.width, rect.y + rect.height - top);
  ctx.fillStyle = GROUND_EDGE;
  ctx.fillRect(rect.x, top, rect.width, GROUND_EDGE_PX);
}

/** A world tile's top-left for something whose bottom-left anchor tile stands at `leftX` on the ground line. */
function standingTile(rect: IllustrationRect, leftX: number): { x: number; y: number } {
  return { x: leftX, y: groundY(rect) - STAGE_TILE };
}

/** Draws a village standing prop's baked frame at variant 0, the same art the real village bakes. */
function drawStationProp(
  ctx: CanvasRenderingContext2D,
  prop: VillageStandingPropId,
  x: number,
  y: number,
  tileSize: number,
): void {
  const def = getSpriteDefByKey(villagePropSheetKey(prop));
  const stateDef = def?.states.get(prop);
  if (def === undefined || stateDef === undefined) return;
  const variant = 0;
  drawSprite(ctx, def, stateDef, variant, x, y, tileSize);
}

/** A point offset from a standing tile's own anchor, the same convention `villageArt.ts`'s overlay anchors use. */
function fromAnchor(
  tile: { x: number; y: number },
  rect: IllustrationRect,
  anchor: OverlayAnchor,
): { x: number; y: number } {
  return { x: tile.x + anchor.x * STAGE_TILE, y: groundY(rect) - anchor.up * STAGE_TILE };
}

function drawWorker(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  x: number,
  frame: number,
): void {
  const frameCount = humanRowOf(WORKER_ROW)?.frameCount ?? 1;
  const workFrame = Math.floor(frame / WORK_TICKS_PER_FRAME) % frameCount;
  const worker = standingTile(rect, x);
  drawFigureCached(ctx, HUMAN_FIGURE, WORKER_ROW, workFrame, worker.x, worker.y, STAGE_TILE);
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string = LABEL_COLOR,
): void {
  worldText(ctx, text, {
    x,
    y,
    size: LABEL_TEXT_SIZE,
    color,
    align: 'center',
    outline: true,
  });
}

/** One press-and-produce cycle: a log slides in, sits through the work, then pops its output. */
interface CyclePhase {
  readonly kind: 'enter' | 'work' | 'pop' | 'pause';
  readonly progress: number;
}

function cyclePhase(frame: number): CyclePhase {
  const t = frame % CYCLE_FRAMES;
  if (t < ENTER_FRAMES) return { kind: 'enter', progress: t / ENTER_FRAMES };
  const sinceWork = t - ENTER_FRAMES;
  if (sinceWork < WORK_FRAMES) return { kind: 'work', progress: sinceWork / WORK_FRAMES };
  const sincePop = sinceWork - WORK_FRAMES;
  if (sincePop < POP_FRAMES) return { kind: 'pop', progress: sincePop / POP_FRAMES };
  const sincePause = sincePop - POP_FRAMES;
  return { kind: 'pause', progress: sincePause / PAUSE_FRAMES };
}

interface StationScene {
  readonly prop: VillageStandingPropId;
  readonly outputIcon: 'wood_board' | 'rope';
  readonly outputLabel: string;
}

const SAW_BLADE_ANCHOR: OverlayAnchor = { x: 1, up: 1.95 };
const SAW_BLADE_RADIUS_TILES = 0.42;
const SAW_BLADE_ALPHA = 0.85;
const SAW_BLADE_OUTLINE_WIDTH = 2;
/** The streak spokes sit inside the blade's own rim, so they read as motion blur rather than a second ring. */
const SAW_BLADE_STREAK_RADIUS_SHARE = 0.7;
const BLADE_SPOKES = 6;
const BLADE_SPIN_RADIANS_PER_FRAME = 0.35;
const BLADE_STREAK_RADIANS = 0.4;
const FULL_TURN = Math.PI * 2;

function drawSpinningBlade(
  ctx: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  frame: number,
): void {
  const radius = SAW_BLADE_RADIUS_TILES * STAGE_TILE;
  ctx.save();
  ctx.globalAlpha *= SAW_BLADE_ALPHA;
  ctx.fillStyle = IRON.light;
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = IRON.glint;
  ctx.lineWidth = SAW_BLADE_OUTLINE_WIDTH;
  const spin = frame * BLADE_SPIN_RADIANS_PER_FRAME;
  for (let spoke = 0; spoke < BLADE_SPOKES; spoke++) {
    const angle = spin + (spoke / BLADE_SPOKES) * FULL_TURN;
    ctx.beginPath();
    ctx.arc(
      anchor.x,
      anchor.y,
      radius * SAW_BLADE_STREAK_RADIUS_SHARE,
      angle,
      angle + BLADE_STREAK_RADIANS,
    );
    ctx.stroke();
  }
  ctx.restore();
}

const ROPE_TWIST_ANCHOR: OverlayAnchor = { x: 1, up: 1.1 };
const ROPE_TWIST_RADIUS = 9;
const ROPE_TWIST_INNER_RADIUS_SHARE = 0.55;
const ROPE_TWIST_TURNS_PER_FRAME = 0.12;
const ROPE_TWIST_OUTER_ARC_TURNS = 1.4;
const ROPE_TWIST_INNER_ARC_TURNS = 1.1;
const ROPE_TWIST_LINE_WIDTH = 3;
const ROPE_COLOR = '#b98a4a';

function drawRopeTwist(
  ctx: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  frame: number,
): void {
  ctx.save();
  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = ROPE_TWIST_LINE_WIDTH;
  ctx.lineCap = 'round';
  const twist = frame * ROPE_TWIST_TURNS_PER_FRAME;
  ctx.beginPath();
  ctx.arc(
    anchor.x,
    anchor.y,
    ROPE_TWIST_RADIUS,
    twist,
    twist + Math.PI * ROPE_TWIST_OUTER_ARC_TURNS,
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(
    anchor.x,
    anchor.y,
    ROPE_TWIST_RADIUS * ROPE_TWIST_INNER_RADIUS_SHARE,
    -twist,
    -twist + Math.PI * ROPE_TWIST_INNER_ARC_TURNS,
  );
  ctx.stroke();
  ctx.restore();
}

const SAW_SCENE: StationScene = {
  prop: 'sawmill_machine',
  outputIcon: 'wood_board',
  outputLabel: `+${BOARDS_PER_WOOD} Boards`,
};

const ROPE_SCENE: StationScene = {
  prop: 'rope_walk',
  outputIcon: 'rope',
  outputLabel: `+${ROPE_PER_WOOD} Rope`,
};

/** The `size` square whose centre is (`cx`, `cy`). */
function centredSquare(cx: number, cy: number, size: number): Rect {
  const half = size / 2;
  return { x: cx - half, y: cy - half, w: size, h: size };
}

/** Draws a station's whole cycle: the log arriving, the machine running, and the output popping free. */
function drawStationScene(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
  scene: StationScene,
  spinner: (ctx: CanvasRenderingContext2D, anchor: { x: number; y: number }, frame: number) => void,
  spinnerAnchor: OverlayAnchor,
): void {
  drawGround(ctx, rect);
  const stationLeftX = rect.x + rect.width * STATION_LEFT_SHARE;
  const stationTile = standingTile(rect, stationLeftX);
  drawStationProp(ctx, scene.prop, stationTile.x, stationTile.y, STAGE_TILE);

  const workerX = stationLeftX - STAGE_TILE * WORKER_OFFSET_TILES;
  drawWorker(ctx, rect, workerX, frame);

  const phase = cyclePhase(frame);
  const feedX = workerX + STAGE_TILE * FEED_OFFSET_TILES;
  const feedY = groundY(rect) - STAGE_TILE * FEED_HEIGHT_TILES;

  if (phase.kind === 'enter') {
    const fromX = rect.x - LOG_ICON_SIZE;
    const x = fromX + (feedX - fromX) * phase.progress;
    drawResourceIcon(ctx, centredSquare(x, feedY, LOG_ICON_SIZE), 'wood');
  } else if (phase.kind === 'work') {
    drawResourceIcon(ctx, centredSquare(feedX, feedY, LOG_ICON_SIZE), 'wood');
    spinner(ctx, fromAnchor(stationTile, rect, spinnerAnchor), frame);
    if (phase.progress > CONSUMED_NOTICE_AT_PROGRESS) {
      drawLabel(ctx, '-1 Wood', feedX, feedY - LOG_ICON_SIZE, CONSUMED_COLOR);
    }
  } else if (phase.kind === 'pop') {
    const rise = phase.progress * POP_RISE_PX;
    const alpha = 1 - phase.progress;
    const popX = stationTile.x + STAGE_TILE;
    const popY = feedY - rise;
    ctx.save();
    ctx.globalAlpha *= alpha;
    drawResourceIcon(ctx, centredSquare(popX, popY, OUTPUT_ICON_SIZE), scene.outputIcon);
    worldText(ctx, scene.outputLabel, {
      x: popX,
      y: popY - OUTPUT_ICON_SIZE,
      size: POP_TEXT_SIZE,
      bold: true,
      color: POP_COLOR,
      outline: true,
      align: 'center',
      alpha,
    });
    ctx.restore();
  }
}

export function drawSawPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  drawStationScene(ctx, rect, frame, SAW_SCENE, drawSpinningBlade, SAW_BLADE_ANCHOR);
}

export function drawRopeWalkPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  drawStationScene(ctx, rect, frame, ROPE_SCENE, drawRopeTwist, ROPE_TWIST_ANCHOR);
}

// ── Fenna's batch page ──────────────────────────────────────────────────────

const COIN_RADIUS = 11;
const COIN_FILL = '#facc15';
const COIN_EDGE = '#a16207';
const COIN_EDGE_WIDTH = 2;
const COIN_BOUNCE_PERIOD_FRAMES = 90;
const COIN_BOUNCE_PX = 4;
const FENNA_ICON_SIZE = 30;
/** How far apart the boards and rope icons sit, in icon heights, so the two outputs don't touch. */
const FENNA_OUTPUT_ROW_GAP_ICONS = 0.8;
const FENNA_LABEL_GAP = 8;
const FENNA_ARROW_SIZE = 22;
const FENNA_ARROW_COLOR = '#e2e8f0';
/** The three columns — wood, fee, output — share the band's height at this fraction. */
const FENNA_ROW_Y_SHARE = 0.42;
const FENNA_COLUMN_COUNT = 3;
const FENNA_COLUMN_CENTRE = 0.5;

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number): void {
  const bounce = Math.sin((frame / COIN_BOUNCE_PERIOD_FRAMES) * FULL_TURN) * COIN_BOUNCE_PX;
  ctx.save();
  ctx.fillStyle = COIN_FILL;
  ctx.strokeStyle = COIN_EDGE;
  ctx.lineWidth = COIN_EDGE_WIDTH;
  ctx.beginPath();
  ctx.arc(x, y - bounce, COIN_RADIUS, 0, FULL_TURN);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  worldText(ctx, '→', {
    x,
    y,
    size: FENNA_ARROW_SIZE,
    bold: true,
    color: FENNA_ARROW_COLOR,
    align: 'center',
  });
}

function fennaColumnCentre(rect: IllustrationRect, index: number): number {
  const columnWidth = rect.width / FENNA_COLUMN_COUNT;
  return rect.x + columnWidth * (index + FENNA_COLUMN_CENTRE);
}

export function drawFennaPage(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  const centreY = rect.y + rect.height * FENNA_ROW_Y_SHARE;
  const woodX = fennaColumnCentre(rect, 0);
  const coinX = fennaColumnCentre(rect, 1);
  const outX = fennaColumnCentre(rect, 2);
  const half = FENNA_ICON_SIZE / 2;

  drawResourceIcon(ctx, centredSquare(woodX, centreY, FENNA_ICON_SIZE), 'wood');
  drawLabel(ctx, '1 Wood', woodX, centreY + half + LABEL_GAP);

  drawArrow(ctx, (woodX + coinX) / 2, centreY);
  drawCoin(ctx, coinX, centreY, frame);
  drawLabel(ctx, `${FENNA_FEE_PER_WOOD} coin`, coinX, centreY + COIN_RADIUS + LABEL_GAP);

  drawArrow(ctx, (coinX + outX) / 2, centreY);
  const boardsY = centreY - FENNA_ICON_SIZE * FENNA_OUTPUT_ROW_GAP_ICONS;
  const ropeY = centreY + FENNA_ICON_SIZE * FENNA_OUTPUT_ROW_GAP_ICONS;
  drawResourceIcon(ctx, centredSquare(outX, boardsY, FENNA_ICON_SIZE), 'wood_board');
  drawLabel(ctx, `${BOARDS_PER_WOOD} Boards`, outX, boardsY + half + FENNA_LABEL_GAP);
  drawResourceIcon(ctx, centredSquare(outX, ropeY, FENNA_ICON_SIZE), 'rope');
  drawLabel(ctx, `or ${ROPE_PER_WOOD} Rope`, outX, ropeY + half + FENNA_LABEL_GAP);
}

// ── Pages ──────────────────────────────────────────────────────────────────
