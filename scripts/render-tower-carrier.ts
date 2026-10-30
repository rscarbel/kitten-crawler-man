/**
 * Headless review harness for the binding's carrier and its pillars.
 *
 *   preview/missing-cats/tower/carrier-<kind>.png  every carrier row, every frame, at 3x,
 *                                                 then each row at the 32 px tile, blown up
 *                                                 nearest-neighbour so the game-size read is honest
 *   preview/missing-cats/tower/pillar-shatter.png  the binding pillar dormant, lit and broken,
 *                                                 and the shatter frame by frame, at 32 px and 4x
 *
 *   preview/missing-cats/tower/flight-<kind>.png   the carrier's whole visit, stage by stage, over a
 *                                                 pillar on a stretch of floor at the 32 px tile, 3x
 *
 *   npm run render:tower-carrier
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';

installCanvasGlobals();

const { TILE_SIZE } = await import('../src/core/constants.js');
const { towerCarrierFigure, prewarmTowerCarrier } =
  await import('../src/sprites/art/towerCarrierFigure.js');
const { bakeFigurePrewarmFor } = await import('../src/sprites/figure/figureFrameCache.js');
const { drawTownInteriorProp } =
  await import('../src/sprites/art/townInterior/townInteriorProps.js');
const { drawBindingPillarShatter, BINDING_PILLAR_SHATTER_FRAMES } =
  await import('../src/sprites/art/townInterior/rooms/towerStoreys.js');
const { CarrierView, carrierFlightPose } = await import('../src/systems/lichCarrierFlight.js');
const { TOWN_CATS } = await import('../src/systems/critters/TownCats.js');
type TowerCarrierKind = import('../src/sprites/art/towerCarrierFigure.js').TowerCarrierKind;

const OUT_DIR = `${PREVIEW_DIR}/missing-cats/tower`;
const REVIEW_SCALE = 3;
const GAME_ZOOM = 4;
const PADDING = 8;
const LABEL_HEIGHT = 18;
const BACKDROP = '#2a2a30';
const FLOOR_A = '#4a4038';
const FLOOR_B = '#443a33';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
/** The carrier is painted on 64 px tiles; the game draws 32. */
const CARRIER_ART_TILE = 64;
const IN_GAME_SCALE = TILE_SIZE / CARRIER_ART_TILE;
const CARRIER_KINDS: readonly TowerCarrierKind[] = ['deacon_aviel', 'roost_hawk'];
const PILLAR_VARIANT = { dormant: 0, lit: 1, broken: 2 } as const;
/** Tiles of room round each pillar cell, so rubble and flying stone have floor under them. */
const PILLAR_CELL_TILES = 3;
const SHATTER_SAMPLES = 8;

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING / 2);
}

function paintFloor(ctx: NodeCtx, x: number, y: number, w: number, h: number, tile: number): void {
  for (let ty = 0; ty < h; ty += tile) {
    for (let tx = 0; tx < w; tx += tile) {
      const even = (Math.floor(tx / tile) + Math.floor(ty / tile)) % 2 === 0;
      ctx.fillStyle = even ? FLOOR_A : FLOOR_B;
      ctx.fillRect(x + tx, y + ty, Math.min(tile, w - tx), Math.min(tile, h - ty));
    }
  }
}

function save(name: string, canvas: Canvas): void {
  const path = writePreviewPng(`${OUT_DIR}/${name}`, canvas.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

function renderCarrier(kind: TowerCarrierKind): void {
  const figure = towerCarrierFigure(kind);
  const states = figureStateNames(figure);
  const maxFrames = Math.max(...states.map((state) => frameCountOf(figure, state)));
  const reviewW = figure.frameWidth * IN_GAME_SCALE * REVIEW_SCALE;
  const reviewH = figure.frameHeight * IN_GAME_SCALE * REVIEW_SCALE;
  const gameW = figure.frameWidth * IN_GAME_SCALE;
  const gameH = figure.frameHeight * IN_GAME_SCALE;
  const reviewBlockH = states.length * (reviewH + LABEL_HEIGHT + PADDING);
  const gameBlockH = states.length * (gameH * GAME_ZOOM + LABEL_HEIGHT + PADDING);
  const width = PADDING + maxFrames * (Math.max(reviewW, gameW * GAME_ZOOM) + PADDING);
  const canvas = createCanvas(width, PADDING + reviewBlockH + gameBlockH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = PADDING;
  for (const state of states) {
    label(ctx, `${kind} ${state} (3x)`, PADDING, y);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frameCountOf(figure, state); frame++) {
      const x = PADDING + frame * (reviewW + PADDING);
      paintFloor(ctx, x, y, reviewW, reviewH, TILE_SIZE * REVIEW_SCALE);
      ctx.drawImage(bakeFigureCell(figure, state, frame), x, y, reviewW, reviewH);
    }
    y += reviewH + PADDING;
  }

  for (const state of states) {
    label(ctx, `${kind} ${state} (32 px tile, ${GAME_ZOOM}x nearest)`, PADDING, y);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frameCountOf(figure, state); frame++) {
      const small = createCanvas(gameW, gameH);
      const smallCtx = small.getContext('2d');
      paintFloor(smallCtx, 0, 0, gameW, gameH, TILE_SIZE);
      smallCtx.drawImage(bakeFigureCell(figure, state, frame), 0, 0, gameW, gameH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        small,
        PADDING + frame * (gameW * GAME_ZOOM + PADDING),
        y,
        gameW * GAME_ZOOM,
        gameH * GAME_ZOOM,
      );
      ctx.imageSmoothingEnabled = true;
    }
    y += gameH * GAME_ZOOM + PADDING;
  }
  save(`carrier-${kind}.png`, canvas);
}

/** One pillar on a little stretch of floor at the 32 px tile, with the shatter at `progress` over it. */
function pillarCell(variant: number, progress: number | null): Canvas {
  const size = PILLAR_CELL_TILES * TILE_SIZE;
  const cell = createCanvas(size, size);
  const ctx = cell.getContext('2d');
  paintFloor(ctx, 0, 0, size, size, TILE_SIZE);
  const col = 1;
  const row = 1;
  const gameCtx = asGameContext(ctx);
  drawTownInteriorProp(gameCtx, 'binding_pillar', variant, col, row, 0, 0, TILE_SIZE);
  if (progress !== null) {
    drawBindingPillarShatter(
      gameCtx,
      (col + 0.5) * TILE_SIZE,
      (row + 1) * TILE_SIZE,
      TILE_SIZE,
      progress,
    );
  }
  return cell;
}

function renderPillars(): void {
  const size = PILLAR_CELL_TILES * TILE_SIZE * GAME_ZOOM;
  const columns = Math.max(Object.keys(PILLAR_VARIANT).length, SHATTER_SAMPLES);
  const width = PADDING + columns * (size + PADDING);
  const height = PADDING + 2 * (LABEL_HEIGHT + size + PADDING);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  let y = PADDING;
  Object.entries(PILLAR_VARIANT).forEach(([name, variant], index) => {
    const x = PADDING + index * (size + PADDING);
    label(ctx, name, x, y);
    ctx.drawImage(pillarCell(variant, null), x, y + LABEL_HEIGHT, size, size);
  });
  y += LABEL_HEIGHT + size + PADDING;
  for (let i = 0; i < SHATTER_SAMPLES; i++) {
    const progress = i / (SHATTER_SAMPLES - 1);
    const frame = Math.round(progress * BINDING_PILLAR_SHATTER_FRAMES);
    const x = PADDING + i * (size + PADDING);
    label(ctx, `shatter f${frame}`, x, y);
    ctx.drawImage(pillarCell(PILLAR_VARIANT.broken, progress), x, y + LABEL_HEIGHT, size, size);
  }
  save('pillar-shatter.png', canvas);
}

/** The visit's stages, sampled: in through the window, the stoop, and out with the cat. */
const FLIGHT_SAMPLES = [
  { stage: 'arriving', progress: 0.1 },
  { stage: 'arriving', progress: 0.45 },
  { stage: 'arriving', progress: 0.9 },
  { stage: 'lifting', progress: 0.2 },
  { stage: 'lifting', progress: 0.5 },
  { stage: 'lifting', progress: 0.8 },
  { stage: 'leaving', progress: 0.1 },
  { stage: 'leaving', progress: 0.5 },
] as const;
/** A stretch of floor with the window's tile at the top and the pillar below it, in tiles. */
const FLIGHT_ROOM = { cols: 6, rows: 6 } as const;
const FLIGHT_WINDOW = { col: 4, row: 0 } as const;
const FLIGHT_PILLAR = { col: 2, row: 2 } as const;
const FLIGHT_ZOOM = 3;

function renderFlight(kind: TowerCarrierKind): void {
  const roomW = FLIGHT_ROOM.cols * TILE_SIZE;
  const roomH = FLIGHT_ROOM.rows * TILE_SIZE;
  const view = new CarrierView(kind, () => TOWN_CATS.taloncrest_inn_cat.look);
  // The runtime warms these rows when the fight begins; a harness that drew
  // cold would review whatever stand-in cell the cache offered instead.
  prewarmTowerCarrier(kind);
  bakeFigurePrewarmFor(Number.POSITIVE_INFINITY, true);
  const width = PADDING + FLIGHT_SAMPLES.length * (roomW * FLIGHT_ZOOM + PADDING);
  const canvas = createCanvas(width, PADDING + LABEL_HEIGHT + roomH * FLIGHT_ZOOM + PADDING);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  FLIGHT_SAMPLES.forEach(({ stage, progress }, index) => {
    const room = createCanvas(roomW, roomH);
    const roomCtx = room.getContext('2d');
    paintFloor(roomCtx, 0, 0, roomW, roomH, TILE_SIZE);
    const broken = stage === 'leaving';
    const roomGameCtx = asGameContext(roomCtx);
    drawTownInteriorProp(
      roomGameCtx,
      'binding_pillar',
      broken ? PILLAR_VARIANT.broken : PILLAR_VARIANT.lit,
      FLIGHT_PILLAR.col,
      FLIGHT_PILLAR.row,
      0,
      0,
      TILE_SIZE,
    );
    const pose = carrierFlightPose(stage, progress, FLIGHT_WINDOW, FLIGHT_PILLAR);
    view.render(roomGameCtx, 0, 0, pose, 'pillar');
    const x = PADDING + index * (roomW * FLIGHT_ZOOM + PADDING);
    label(ctx, `${stage} ${progress}`, x, PADDING);
    ctx.drawImage(room, x, PADDING + LABEL_HEIGHT, roomW * FLIGHT_ZOOM, roomH * FLIGHT_ZOOM);
  });
  view.dispose();
  save(`flight-${kind}.png`, canvas);
}

for (const kind of CARRIER_KINDS) {
  renderCarrier(kind);
  renderFlight(kind);
}
renderPillars();
