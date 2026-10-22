#!/usr/bin/env tsx
/**
 * Review harness for Deuce, the Desperado Club's blackjack dealer.
 *
 *   npm run render:casino-dealer
 *
 * Writes into `preview/casino-dealer/`:
 *   - `world-in-club-4x.png` — the casino corner of the real club floor with
 *     its real neighbours, so Deuce is judged against the cast he stands among.
 *   - `world-stage.png` / `world-stage-4x.png` — Deuce behind his own table,
 *     resting and dealing, at several moments of each loop.
 *   - `world-closeup-8x.png` — the same, cropped tight on Deuce and his table.
 *   - `portrait-states.png` / `portrait-states-3x.png` — the wide panel's
 *     portrait in every `DealerState`, at the size the panel paints it.
 *   - `portrait-motion-3x.png` — the dealing and waiting loops across time.
 *   - `bust-states.png` / `bust-states-4x.png` — the phone headers' busts.
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
const { CLUB_STATIONS } = await import('../src/core/clubLayout.js');
const { drawClubProp } = await import('../src/sprites/clubFurnitureSprite.js');
const { drawCasinoDealer, drawCasinoDealerHands, drawDeucePortrait } =
  await import('../src/sprites/casinoDealerSprite.js');

type DealerState = Parameters<typeof drawDeucePortrait>[5];

const OUT_DIR = `${PREVIEW_DIR}/casino-dealer`;
const TOWN_PLAN_SIZE = 280;
const WARM_FRAMES = 90;
const CLUB_BUILDING_NAME = 'The Desperado Club';
const ZOOM_WORLD = 4;
const ZOOM_PORTRAIT = 3;
const ZOOM_BUST = 4;
const BACKGROUND = '#0d1512';
const PORTRAIT_INSET = '#10241c';
const LABEL = '#d8d0b8';
const LABEL_FONT = '10px sans-serif';
const LABEL_BAND = 14;
const GAP = 8;

/** The wide panel's portrait column, at a typical desktop panel size. */
const PORTRAIT_W = 190;
const PORTRAIT_H = 300;
/** The compact and landscape header busts, from `casinoLayout.ts`. */
const BUST_SIZES: ReadonlyArray<number> = [54, 36];

const STATES: ReadonlyArray<DealerState> = [
  'idle',
  'dealing',
  'flipping',
  'waiting_on_player',
  'concede',
  'smug',
  'impressed',
  'bust',
];
/** Moments sampled across the loops: mid-breath, mid-deal, a blink, a deck squaring. */
const STAGE_TIMES_MS: ReadonlyArray<number> = [300, 650, 900, 1150, 4700];
const MOTION_TIMES_MS: ReadonlyArray<number> = [0, 233, 466, 700, 933, 1166];
const STILL_PORTRAIT_MS = 2000;
const TIMED_FRAMES = 300;
const FRAME_MS = 1000 / 60;
interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const CASINO_CROP: TileRect = { x0: 17, y0: 0, x1: 24, y1: 8 };
/** Deuce and his table, tight, for judging the figure itself. */
const DEALER_CLOSEUP: TileRect = { x0: 19, y0: 3, x1: 22, y1: 6 };
const ZOOM_CLOSEUP = 8;

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

const casinoStation = CLUB_STATIONS.find((station) => station.id === 'casino');
if (casinoStation === undefined) throw new Error('club has no casino station');
const casinoProps = CLUB_PROPS.filter(
  (prop) =>
    prop.tile.x >= CASINO_CROP.x0 &&
    prop.tile.x < CASINO_CROP.x1 &&
    prop.tile.y >= CASINO_CROP.y0 &&
    prop.tile.y < CASINO_CROP.y1,
);

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y);
}

function save(name: string, canvas: Canvas): void {
  const path = writePreviewPng(`${OUT_DIR}/${name}`, canvas.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

/** The club corner with every real figure in it, Deuce resting among them. */
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

/**
 * Deuce on his own stage: the floor, the wheel behind him, then Deuce, then the
 * table and stools in front — the same stacking the club's Y-sort produces.
 */
function paintStage(ctx: NodeCtx, phaseMs: number, dealing: boolean): void {
  const gameCtx = asGameContext(ctx);
  const camX = CASINO_CROP.x0 * TILE_SIZE;
  const camY = CASINO_CROP.y0 * TILE_SIZE;
  const cropW = (CASINO_CROP.x1 - CASINO_CROP.x0) * TILE_SIZE;
  const cropH = (CASINO_CROP.y1 - CASINO_CROP.y0) * TILE_SIZE;
  map.renderCanvas(gameCtx, camX, camY, cropW, cropH);
  club.renderFloor(gameCtx, camX, camY);
  const dealerSortY = casinoStation.tile.y * TILE_SIZE;
  for (const prop of casinoProps) {
    if (prop.tile.y * TILE_SIZE <= dealerSortY) drawClubProp(gameCtx, prop, camX, camY, 0);
  }
  drawCasinoDealer(
    gameCtx,
    casinoStation.tile.x * TILE_SIZE - camX,
    casinoStation.tile.y * TILE_SIZE - camY,
    TILE_SIZE,
    phaseMs,
    dealing,
  );
  const tableProps = casinoProps.filter((prop) => prop.tile.y * TILE_SIZE > dealerSortY);
  for (const prop of tableProps) drawClubProp(gameCtx, prop, camX, camY, 0);
  drawCasinoDealerHands(
    gameCtx,
    casinoStation.tile.x * TILE_SIZE - camX,
    casinoStation.tile.y * TILE_SIZE - camY,
    TILE_SIZE,
    phaseMs,
    dealing,
  );
}

function renderStage(zoom: number, name: string, crop: TileRect = CASINO_CROP): void {
  const cropW = (crop.x1 - crop.x0) * TILE_SIZE;
  const cropH = (crop.y1 - crop.y0) * TILE_SIZE;
  const cellW = cropW * zoom;
  const cellH = cropH * zoom;
  const modes: ReadonlyArray<boolean> = [false, true];
  const canvas = createCanvas(
    STAGE_TIMES_MS.length * (cellW + GAP) + GAP,
    modes.length * (cellH + LABEL_BAND + GAP) + GAP,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  modes.forEach((dealing, row) => {
    STAGE_TIMES_MS.forEach((phaseMs, column) => {
      const x = GAP + column * (cellW + GAP);
      const y = GAP + row * (cellH + LABEL_BAND + GAP);
      label(ctx, `${dealing ? 'dealing' : 'resting'} ${phaseMs}ms`, x, y + LABEL_BAND - 3);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y + LABEL_BAND, cellW, cellH);
      ctx.clip();
      ctx.translate(x, y + LABEL_BAND);
      ctx.scale(zoom, zoom);
      ctx.translate((CASINO_CROP.x0 - crop.x0) * TILE_SIZE, (CASINO_CROP.y0 - crop.y0) * TILE_SIZE);
      paintStage(ctx, phaseMs, dealing);
      ctx.restore();
    });
  });
  save(name, canvas);
}

interface PortraitSheet {
  name: string;
  w: number;
  h: number;
  zoom: number;
  cells: ReadonlyArray<{ state: DealerState; phaseMs: number; caption: string }>;
}

function renderPortraitSheet(sheet: PortraitSheet): void {
  const cellW = sheet.w * sheet.zoom;
  const cellH = sheet.h * sheet.zoom;
  const canvas = createCanvas(
    sheet.cells.length * (cellW + GAP) + GAP,
    cellH + LABEL_BAND + GAP * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  sheet.cells.forEach((cell, i) => {
    const x = GAP + i * (cellW + GAP);
    const y = GAP;
    label(ctx, cell.caption, x, y + LABEL_BAND - 3);
    ctx.save();
    ctx.translate(x, y + LABEL_BAND);
    ctx.scale(sheet.zoom, sheet.zoom);
    ctx.fillStyle = PORTRAIT_INSET;
    ctx.fillRect(0, 0, sheet.w, sheet.h);
    drawDeucePortrait(asGameContext(ctx), 0, 0, sheet.w, sheet.h, cell.state, cell.phaseMs, {
      lookY: cell.state === 'waiting_on_player' ? 1 : -1,
    });
    ctx.restore();
  });
  save(sheet.name, canvas);
}

const stillCells = STATES.map((state) => ({ state, phaseMs: STILL_PORTRAIT_MS, caption: state }));

renderClubCorner();
renderStage(1, 'world-stage.png');
renderStage(ZOOM_WORLD, 'world-stage-4x.png');
renderStage(ZOOM_CLOSEUP, 'world-closeup-8x.png', DEALER_CLOSEUP);
for (const zoom of [1, ZOOM_PORTRAIT]) {
  renderPortraitSheet({
    name: zoom === 1 ? 'portrait-states.png' : 'portrait-states-3x.png',
    w: PORTRAIT_W,
    h: PORTRAIT_H,
    zoom,
    cells: stillCells,
  });
}
renderPortraitSheet({
  name: 'portrait-motion-3x.png',
  w: PORTRAIT_W,
  h: PORTRAIT_H,
  zoom: ZOOM_PORTRAIT,
  cells: [
    ...MOTION_TIMES_MS.map((phaseMs) => ({
      state: 'dealing' as const,
      phaseMs,
      caption: `dealing ${phaseMs}`,
    })),
    { state: 'waiting_on_player', phaseMs: 0, caption: 'waiting 0' },
    { state: 'waiting_on_player', phaseMs: 550, caption: 'waiting 550 (square)' },
    { state: 'idle', phaseMs: 60, caption: 'idle blink' },
  ],
});
for (const size of BUST_SIZES) {
  for (const zoom of [1, ZOOM_BUST]) {
    renderPortraitSheet({
      name: `bust-${size}${zoom === 1 ? '' : `-${zoom}x`}.png`,
      w: size,
      h: size,
      zoom,
      cells: stillCells,
    });
  }
}

/**
 * A rough per-frame cost: the panel's portrait plus both world passes, drawn
 * at device pixel ratio 2 across a few seconds of dealing. Node's Cairo is not
 * Chrome, so read it as a magnitude.
 */
function timeFrames(): void {
  const canvas = createCanvas(
    PORTRAIT_W * REVIEW_DEVICE_PIXEL_RATIO,
    PORTRAIT_H * REVIEW_DEVICE_PIXEL_RATIO,
  );
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.scale(REVIEW_DEVICE_PIXEL_RATIO, REVIEW_DEVICE_PIXEL_RATIO);
  const states: ReadonlyArray<DealerState> = ['dealing', 'waiting_on_player'];
  const drawFrames = (state: DealerState): number => {
    const started = performance.now();
    for (let frame = 0; frame < TIMED_FRAMES; frame++) {
      const phaseMs = frame * FRAME_MS;
      drawDeucePortrait(ctx, 0, 0, PORTRAIT_W, PORTRAIT_H, state, phaseMs, { lookY: 1 });
      drawCasinoDealer(ctx, 0, 0, TILE_SIZE, phaseMs, true);
      drawCasinoDealerHands(ctx, 0, 0, TILE_SIZE, phaseMs, true);
    }
    return (performance.now() - started) / TIMED_FRAMES;
  };
  for (const state of states) {
    const cold = drawFrames(state);
    const warm = drawFrames(state);
    console.log(
      `timing: ${state} portrait + world passes ${cold.toFixed(2)} ms/frame cold, ${warm.toFixed(2)} warm`,
    );
  }
}

timeFrames();
