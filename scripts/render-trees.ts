/**
 * Headless review harness for the Level 3 forest.
 *
 * The browser harness cannot drive this project well enough to judge art from a
 * still, so the trees have to be reviewable offline. Two modes:
 *
 *   npx tsx scripts/render-trees.ts --out=trees.png --scale=2
 *     Contact sheet: every key × every state at review scale, with the anchor
 *     tile boxed, plus a strip of the same sheets blitted at the in-game tile
 *     size where the silhouette is all that survives.
 *
 *   npx tsx scripts/render-trees.ts --forest --out=forest.png --scale=3
 *     A synthetic grove rendered through the *real* tile renderer, so species
 *     coherence, overlap and Y-order can be judged the way the game draws them.
 *     The grove is seeded, unlike `OverworldGenerator`'s forests, so this image
 *     is comparable across runs — which is what makes it the before/after shot.
 *
 * Regenerate the sheets with `npm run gen:trees`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../src/images/environment/trees/manifest.json';
import { mulberry32 } from '../src/sprites/person/rng.js';
import { OVERWORLD_MAP_SIZE_TILES } from './townSheets.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const DEFAULT_CONTACT_OUT = 'trees.png';
const DEFAULT_FOREST_OUT = 'tree-forest.png';
const LABEL_HEIGHT = 20;
const PADDING = 6;
const BACKDROP = '#3b3b40';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const GRID_LINE = 'rgba(255,255,255,0.10)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';

/** Synthetic grove: a rectangle of the overworld cleared to grass and planted. */
// Wide enough to span several groves: the point of the shot is whether the
// species regions blend into one wood, and a view inside a single grove cannot
// answer that.
const FOREST_TILES_W = 62;
const FOREST_TILES_H = 46;
const FOREST_SEED = 0x0f0e57;
const FOREST_TREE_CHANCE = 0.42;
/** Left as a clearing so tree-on-grass edges and Y-order are both visible. */
const FOREST_CLEARING_RADIUS_TILES = 4;
/** Far corner of the wilderness — well clear of the town wall and the tower. */
const FOREST_ORIGIN_TILE = 24;

interface SheetGeometry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Readonly<Record<string, { readonly row: number; readonly frameCount: number }>>;
}

const SHEETS: Readonly<Record<string, SheetGeometry>> = manifest;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseScale(): number {
  const scale = Number(parseFlag('scale', String(DEFAULT_SCALE)));
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`--scale must be a positive number, got "${parseFlag('scale', '')}"`);
  }
  return scale;
}

interface RowSpec {
  readonly name: string;
  readonly row: number;
  readonly frameCount: number;
}

function rowsOf(sheet: SheetGeometry): readonly RowSpec[] {
  return Object.entries(sheet.states)
    .map(([name, state]) => ({ name, row: state.row, frameCount: state.frameCount }))
    .sort((a, b) => a.row - b.row);
}

/** `--keys=`/`--states=` filters. Empty means "everything in the manifest". */
function selection(flag: string): ReadonlySet<string> | null {
  const raw = parseFlag(flag, '');
  if (raw === '') return null;
  return new Set(raw.split(',').map((part) => part.trim()));
}

interface Cell {
  readonly key: string;
  readonly label: string;
  readonly row: number;
  readonly frame: number;
}

/** How many cells fit on a line before the gallery wraps. */
const GALLERY_COLUMNS = 7;
/** Marks a padding cell, which reserves a grid slot but draws nothing. */
const EMPTY_CELL_ROW = -1;

/**
 * The cells a run wants to see, and how wide to lay them out.
 *
 * Asking for one key means "show me this tree's whole life", which reads best
 * as states down and animation frames across. Asking for several means "compare
 * these", which reads best as a wrapping gallery — the frames of a burn loop are
 * noise when the question is whether twelve trees belong to one forest.
 */
function planCells(
  keys: readonly string[],
  stateFilter: ReadonlySet<string> | null,
): { readonly cells: readonly Cell[]; readonly columns: number } {
  const rowsFor = (key: string): readonly RowSpec[] =>
    rowsOf(SHEETS[key]).filter((row) => stateFilter === null || stateFilter.has(row.name));

  if (keys.length === 1) {
    const key = keys[0];
    const rows = rowsFor(key);
    // Settled over every row *before* any cell is emitted. Growing it inside the
    // loop meant the one-frame states padded against a width of 1 while the
    // layout below used the final maximum, so `burning` began mid-line and split
    // across two grid rows — a review harness that lies about its own geometry.
    const columns = Math.max(1, ...rows.map((spec) => spec.frameCount));
    const cells: Cell[] = [];
    for (const spec of rows) {
      for (let frame = 0; frame < spec.frameCount; frame++) {
        cells.push({ key, label: `${spec.name} ${frame}`, row: spec.row, frame });
      }
      // Pad the line out so the next state starts on a fresh one.
      while (cells.length % columns !== 0) {
        cells.push({ key, label: '', row: EMPTY_CELL_ROW, frame: 0 });
      }
    }
    return { cells, columns };
  }

  const cells: Cell[] = [];
  for (const key of keys) {
    for (const spec of rowsFor(key)) {
      cells.push({ key, label: `${key} ${spec.name}`, row: spec.row, frame: 0 });
    }
  }
  return { cells, columns: Math.min(GALLERY_COLUMNS, cells.length) };
}

async function drawContactSheet(scale: number): Promise<Buffer> {
  // Thirteen sheets x six states x six frames is twenty thousand pixels of
  // contact sheet, which is not reviewable by eye. The filters exist so a review
  // can ask for one axis at a time.
  const keyFilter = selection('keys');
  const stateFilter = selection('states');
  const keys = Object.keys(SHEETS).filter((key) => keyFilter === null || keyFilter.has(key));
  if (keys.length === 0) throw new Error('--keys matched nothing in the trees manifest');
  // A plain object rather than a Map: every selected key is loaded here and the
  // set never changes, so a lookup can be indexed rather than guarded against an
  // absence that cannot happen.
  const images: Record<string, Image> = {};
  for (const key of keys) {
    images[key] = await loadImage(resolve(`src/images/${SHEETS[key].path}`));
  }

  const { cells, columns } = planCells(keys, stateFilter);
  if (cells.length === 0) throw new Error('--states matched nothing in the trees manifest');

  const cellW = Math.max(...keys.map((key) => SHEETS[key].frameWidth)) * scale;
  const cellH = Math.max(...keys.map((key) => SHEETS[key].frameHeight)) * scale;
  const rows = Math.ceil(cells.length / columns);
  const inGameStripHeight = LABEL_HEIGHT + cellH / scale + PADDING;

  // The in-game strip below the grid lays every selected sheet out in a single
  // row at 1:1, which at a small --scale is wider than the grid itself. Sizing
  // the canvas to the grid alone silently truncated it off the right edge.
  const stripWidth =
    PADDING +
    keys.reduce((total, key) => {
      const sheet = SHEETS[key];
      return total + sheet.frameWidth * (IN_GAME_TILE / sheet.tileScale) + PADDING;
    }, 0);
  const width = Math.max(PADDING + columns * (cellW + PADDING), stripWidth);
  const height = PADDING + rows * (cellH + LABEL_HEIGHT + PADDING) + inGameStripHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  cells.forEach((cell, index) => {
    if (cell.row === EMPTY_CELL_ROW) return;
    const sheet = SHEETS[cell.key];
    const image = images[cell.key];
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    const x = PADDING + column * (cellW + PADDING);
    const y = PADDING + rowIndex * (cellH + LABEL_HEIGHT + PADDING);

    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(cell.label, x, y + LABEL_HEIGHT - PADDING);
    const top = y + LABEL_HEIGHT;
    ctx.drawImage(
      image,
      cell.frame * sheet.frameWidth,
      cell.row * sheet.frameHeight,
      sheet.frameWidth,
      sheet.frameHeight,
      x,
      top,
      sheet.frameWidth * scale,
      sheet.frameHeight * scale,
    );
    ctx.strokeStyle = GRID_LINE;
    ctx.strokeRect(x, top, sheet.frameWidth * scale, sheet.frameHeight * scale);
    // The anchor tile box: the one square the tree actually occupies on the map.
    // Everything outside it is overhang, and overhang that leaves the frame is
    // clipped into the baked sheet for good.
    ctx.strokeStyle = TILE_GUIDE;
    ctx.strokeRect(
      x + sheet.tileX * scale,
      top + sheet.tileY * scale,
      sheet.tileScale * scale,
      sheet.tileScale * scale,
    );
  });

  let stripY = PADDING + rows * (cellH + LABEL_HEIGHT + PADDING);
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `idle at in-game size (${IN_GAME_TILE}px tile)`,
    PADDING,
    stripY + LABEL_HEIGHT - PADDING,
  );
  stripY += LABEL_HEIGHT;
  let stripX = PADDING;
  for (const key of keys) {
    const sheet = SHEETS[key];
    const image = images[key];
    const inGameScale = IN_GAME_TILE / sheet.tileScale;
    ctx.drawImage(
      image,
      0,
      0,
      sheet.frameWidth,
      sheet.frameHeight,
      stripX,
      stripY,
      sheet.frameWidth * inGameScale,
      sheet.frameHeight * inGameScale,
    );
    stripX += sheet.frameWidth * inGameScale + PADDING;
  }

  return canvas.toBuffer('image/png');
}

/**
 * Renders a seeded grove through the game's own tile renderer.
 *
 * The game's modules are written against browser globals, so the shims have to
 * be installed before any of them loads — `SpriteLoader` builds its geometry
 * tables at import time. That is exactly what `loadGameSpritesInNode` is for,
 * hence the dynamic imports below rather than static ones at the top.
 */
async function drawForest(scale: number): Promise<Buffer> {
  const { loadGameSpritesInNode } = await import('./nodeCanvasGlobals.js');
  await loadGameSpritesInNode();

  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { GameMap } = await import('../src/map/GameMap.js');
  const { renderCanvas, renderDecorationsOverlay } = await import('../src/map/TileRenderer.js');
  const { FLOOR_TYPES, TREE } = await import('../src/map/tileTypes.js');

  const gameMap = new GameMap({
    mapSize: OVERWORLD_MAP_SIZE_TILES,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
  });

  // Planted out in the wilderness rather than beside the town: the tower and
  // the wall are decorations this pass would happily draw over the grove, and a
  // review shot of a forest should contain nothing but forest. Flattened to
  // grass first so the wilderness scatter — which is unseeded — cannot change
  // the image between runs.
  const originX = FOREST_ORIGIN_TILE;
  const originY = FOREST_ORIGIN_TILE;
  const grassType = FLOOR_TYPES.indexOf('grass');
  const rng = mulberry32(FOREST_SEED);
  const centreX = originX + FOREST_TILES_W / 2;
  const centreY = originY + FOREST_TILES_H / 2;

  for (let ty = originY; ty < originY + FOREST_TILES_H; ty++) {
    for (let tx = originX; tx < originX + FOREST_TILES_W; tx++) {
      const tile = gameMap.structure[ty][tx];
      tile.type = grassType;
      delete tile.groundType;
      const inClearing = Math.hypot(tx - centreX, ty - centreY) < FOREST_CLEARING_RADIUS_TILES;
      if (!inClearing && rng() < FOREST_TREE_CHANCE) tile.type = TREE;
    }
  }

  const camX = originX * TILE_SIZE;
  const camY = originY * TILE_SIZE;
  const viewW = FOREST_TILES_W * TILE_SIZE;
  const viewH = FOREST_TILES_H * TILE_SIZE;

  const canvas = createCanvas(viewW * scale, viewH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const gameCtx = ctx as unknown as CanvasRenderingContext2D;

  renderCanvas(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
  renderDecorationsOverlay(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);

  return canvas.toBuffer('image/png');
}

async function main(): Promise<void> {
  const scale = parseScale();
  const forest = hasFlag('forest');
  const outPath = parseFlag('out', forest ? DEFAULT_FOREST_OUT : DEFAULT_CONTACT_OUT);
  const buffer = forest ? await drawForest(scale) : await drawContactSheet(scale);
  writeFileSync(resolve(outPath), buffer);
  console.log(`Wrote ${outPath} (${forest ? 'forest' : 'contact sheet'}, scale ${scale}×)`);
}

void main();
