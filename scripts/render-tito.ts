#!/usr/bin/env tsx
/**
 * Review harness for Tito, the Desperado Club's croupier.
 *
 *   npm run render:tito
 *
 * Writes into `preview/tito/`:
 *   - `bust-<size>.png` — the wheel screen's bust at each size it is shown at,
 *     every pose, the lunge across its whole stab.
 *   - `bust-poses-2x.png` — the largest bust's key poses doubled, for the face.
 *   - `world-in-club-4x.png` — the casino corner of the real club floor, Tito
 *     behind his counter among his neighbours.
 *   - `world-closeup-8x.png` — Tito and his counter tight, at moments through
 *     both idle gestures.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
const REVIEW_DEVICE_PIXEL_RATIO = 2;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { createTownPlan } = await import('../src/map/town/townPlan.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { Conversation } = await import('../src/dialog/Conversation.js');
const { createClubMembership } = await import('../src/core/ClubMembership.js');
const { createMercenaryRoster } = await import('../src/core/MercenaryRoster.js');
const { createShopStock } = await import('../src/economy/shopStock.js');
const { DesperadoClubSystem } = await import('../src/systems/DesperadoClubSystem.js');
const { CLUB_PROPS } = await import('../src/core/clubProps.js');
const { CLUB_TITO_POST } = await import('../src/core/clubLayout.js');
const { drawClubProp } = await import('../src/sprites/clubFurnitureSprite.js');
const { drawTitoBust, drawTitoFigure } = await import('../src/sprites/titoSprite.js');

type TitoBustPose = Parameters<typeof drawTitoBust>[4];

const OUT_DIR = `${PREVIEW_DIR}/tito`;
const TOWN_PLAN_SIZE = 280;
const WARM_FRAMES = 90;
const CLUB_BUILDING_NAME = 'The Desperado Club';
const BUST_SIZES: ReadonlyArray<number> = [96, 160, 220];
const ZOOM_WORLD = 4;
const ZOOM_CLOSEUP = 8;
const ZOOM_FACE = 2;
const BACKGROUND = '#0d1512';
const BUST_INSET = '#1a1020';
const LABEL = '#d8d0b8';
const LABEL_FONT = '10px sans-serif';
const LABEL_BAND = 14;
const GAP = 8;
const COLUMNS = 6;
const STILL_MS = 2000;

interface BustCell {
  pose: TitoBustPose;
  progress: number;
  timeMs: number;
  caption: string;
}

const LUNGE_PROGRESS: ReadonlyArray<number> = [
  0, 0.1, 0.2, 0.25, 0.28, 0.32, 0.45, 0.6, 0.75, 0.88, 1,
];
const BUST_CELLS: ReadonlyArray<BustCell> = [
  { pose: 'idle', progress: 0, timeMs: STILL_MS, caption: 'idle' },
  { pose: 'idle', progress: 0, timeMs: 4300 * 3 + 40, caption: 'idle blink' },
  { pose: 'idle', progress: 0, timeMs: 7300 - 500, caption: 'idle glance' },
  { pose: 'grin', progress: 0.4, timeMs: STILL_MS, caption: 'grin 0.4' },
  { pose: 'grin', progress: 0.68, timeMs: STILL_MS, caption: 'grin wink' },
  { pose: 'grin', progress: 1, timeMs: STILL_MS, caption: 'grin 1' },
  { pose: 'chuckle', progress: 0.25, timeMs: STILL_MS, caption: 'chuckle 0.25' },
  { pose: 'chuckle', progress: 0.5, timeMs: STILL_MS, caption: 'chuckle 0.5' },
  ...LUNGE_PROGRESS.map((progress) => ({
    pose: 'lunge' as const,
    progress,
    timeMs: STILL_MS,
    caption: `lunge ${progress}`,
  })),
];
const FACE_CELLS: ReadonlyArray<BustCell> = [
  BUST_CELLS[0],
  BUST_CELLS[5],
  BUST_CELLS[7],
  { pose: 'lunge', progress: 0.15, timeMs: STILL_MS, caption: 'lunge windup' },
  { pose: 'lunge', progress: 0.5, timeMs: STILL_MS, caption: 'lunge hold' },
];

interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const CASINO_CROP: TileRect = { x0: 17, y0: 0, x1: 24, y1: 8 };
const TITO_CLOSEUP: TileRect = {
  x0: CLUB_TITO_POST.x - 1,
  y0: CLUB_TITO_POST.y - 2,
  x1: CLUB_TITO_POST.x + 2,
  y1: CLUB_TITO_POST.y + 2,
};
/** Moments through the smooth (first cycle) and the beckon (second), plus a still and a glance. */
const WORLD_TIMES_MS: ReadonlyArray<number> = [
  3000,
  400,
  900,
  1300,
  6400 + 500,
  6400 + 900,
  9100 - 600,
];

await loadSprites('src/images/');
const artSeed = FLOOR_ART_SEEDS[0];
paintEnvironmentArtInNode(artSeed);
installCanvasGlobals();

const plan = createTownPlan(TOWN_PLAN_SIZE);
const building = plan.buildings.find((b) => b.name === CLUB_BUILDING_NAME);
if (building === undefined) throw new Error(`town plan has no "${CLUB_BUILDING_NAME}"`);
const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [], artSeed });
map.generateInterior(building.kind, 0, building.name, false, 'default');
map.releaseTileArt();

const human = new HumanPlayer(map.startTile.x, map.startTile.y, TILE_SIZE);
const cat = new CatPlayer(map.startTile.x + 1, map.startTile.y, TILE_SIZE);
const club = new DesperadoClubSystem(
  map,
  createClubMembership(),
  createMercenaryRoster(),
  new Conversation(null),
  null,
  null,
  false,
  human,
  createShopStock(),
);
for (let frame = 0; frame < WARM_FRAMES; frame++) club.update(human, cat);

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y);
}

function save(name: string, canvas: Canvas): void {
  const path = writePreviewPng(`${OUT_DIR}/${name}`, canvas.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

function renderBustSheet(
  name: string,
  size: number,
  zoom: number,
  cells: ReadonlyArray<BustCell>,
): void {
  const cell = size * zoom;
  const columns = Math.min(COLUMNS, cells.length);
  const rows = Math.ceil(cells.length / columns);
  const canvas = createCanvas(columns * (cell + GAP) + GAP, rows * (cell + LABEL_BAND + GAP) + GAP);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  cells.forEach((c, i) => {
    const x = GAP + (i % columns) * (cell + GAP);
    const y = GAP + Math.floor(i / columns) * (cell + LABEL_BAND + GAP);
    label(ctx, c.caption, x, y + LABEL_BAND - 3);
    ctx.save();
    ctx.translate(x, y + LABEL_BAND);
    ctx.scale(zoom, zoom);
    ctx.fillStyle = BUST_INSET;
    ctx.fillRect(0, 0, size, size);
    drawTitoBust(asGameContext(ctx), 0, 0, size, c.pose, c.progress, c.timeMs);
    ctx.restore();
  });
  save(name, canvas);
}

function renderClub(
  name: string,
  crop: TileRect,
  zoom: number,
  timesMs: ReadonlyArray<number>,
): void {
  const cropW = (crop.x1 - crop.x0) * TILE_SIZE;
  const cropH = (crop.y1 - crop.y0) * TILE_SIZE;
  const cellW = cropW * zoom;
  const cellH = cropH * zoom;
  const canvas = createCanvas(timesMs.length * (cellW + GAP) + GAP, cellH + LABEL_BAND + GAP * 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const camX = crop.x0 * TILE_SIZE;
  const camY = crop.y0 * TILE_SIZE;
  timesMs.forEach((timeMs, i) => {
    const x = GAP + i * (cellW + GAP);
    label(ctx, `${timeMs}ms`, x, GAP + LABEL_BAND - 3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, GAP + LABEL_BAND, cellW, cellH);
    ctx.clip();
    ctx.translate(x, GAP + LABEL_BAND);
    ctx.scale(zoom, zoom);
    const gameCtx = asGameContext(ctx);
    map.renderCanvas(gameCtx, camX, camY, cropW, cropH);
    map.renderDecorationsOverlay(gameCtx, camX, camY, cropW, cropH);
    club.renderFloor(gameCtx, camX, camY);
    const titoSortY = CLUB_TITO_POST.y * TILE_SIZE;
    const props = CLUB_PROPS.filter(
      (prop) =>
        prop.tile.x >= crop.x0 - 1 &&
        prop.tile.x < crop.x1 + 1 &&
        prop.tile.y >= crop.y0 &&
        prop.tile.y < crop.y1 + 2,
    );
    for (const prop of props) {
      if (prop.tile.y * TILE_SIZE <= titoSortY) drawClubProp(gameCtx, prop, camX, camY, 0);
    }
    drawTitoFigure(
      gameCtx,
      CLUB_TITO_POST.x * TILE_SIZE - camX,
      CLUB_TITO_POST.y * TILE_SIZE - camY,
      { size: TILE_SIZE, timeMs },
    );
    for (const prop of props) {
      if (prop.tile.y * TILE_SIZE > titoSortY) drawClubProp(gameCtx, prop, camX, camY, 0);
    }
    ctx.restore();
  });
  save(name, canvas);
}

function renderClubCorner(): void {
  const cropW = (CASINO_CROP.x1 - CASINO_CROP.x0) * TILE_SIZE;
  const cropH = (CASINO_CROP.y1 - CASINO_CROP.y0) * TILE_SIZE;
  const canvas = createCanvas(cropW * ZOOM_WORLD, cropH * ZOOM_WORLD);
  const ctx = canvas.getContext('2d');
  ctx.scale(ZOOM_WORLD, ZOOM_WORLD);
  const gameCtx = asGameContext(ctx);
  const camX = CASINO_CROP.x0 * TILE_SIZE;
  const camY = CASINO_CROP.y0 * TILE_SIZE;
  map.renderCanvas(gameCtx, camX, camY, cropW, cropH);
  map.renderDecorationsOverlay(gameCtx, camX, camY, cropW, cropH);
  club.renderFloor(gameCtx, camX, camY);
  const figures = [...club.sortedRenderables()].sort((a, b) => a.y - b.y);
  for (const figure of figures) figure.render(gameCtx, camX, camY, TILE_SIZE);
  save('world-in-club-4x.png', canvas);
}

for (const size of BUST_SIZES) renderBustSheet(`bust-${size}.png`, size, 1, BUST_CELLS);
renderBustSheet('bust-poses-2x.png', BUST_SIZES[BUST_SIZES.length - 1], ZOOM_FACE, FACE_CELLS);
renderClubCorner();
renderClub('world-closeup-8x.png', TITO_CLOSEUP, ZOOM_CLOSEUP, WORLD_TIMES_MS);
renderClub('world-1x.png', TITO_CLOSEUP, 1, WORLD_TIMES_MS);
