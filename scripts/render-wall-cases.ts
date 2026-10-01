/**
 * Every dungeon wall shape, both floors side by side, as a PNG — the node twin of
 * the `?tiles` Walls view, over the same fixture.
 *
 *   npx tsx scripts/render-wall-cases.ts --scale=2 --out=preview/wall-cases.png
 *
 * The fixture (`src/map/dungeon/wallCaseFixture.ts`) holds inner and outer
 * corners, corridors leaving through north and side walls, a pillar, a stub,
 * one- and two-tile-thick walls and a face-mounted sign.
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { renderCanvas, renderDecorationsOverlay } from '../src/map/TileRenderer.js';
import { buildWallCaseStructure } from '../src/map/dungeon/wallCaseFixture.js';
import { setDungeonFloorTheme, type DungeonFloorThemeId } from '../src/map/dungeon/floorTheme.js';

const DEFAULT_SCALE = 2;
const DEFAULT_OUT = `${PREVIEW_DIR}/wall-cases.png`;
const GAP_TILES = 1;
const THEMES: ReadonlyArray<DungeonFloorThemeId> = ['cellars', 'service_level'];
const GAP_COLOR = '#12161f';

/** Length of the `--name=` prefix an argument's value starts after. */
const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

const scale = Number.parseInt(stringArg('scale', String(DEFAULT_SCALE)), 10);
const outPath = stringArg('out', DEFAULT_OUT);

await loadGameSpritesInNode();

const structure = buildWallCaseStructure();
const tilesDown = structure.length;
const tilesAcross = structure[0]?.length ?? 0;
const panelW = tilesAcross * TILE_SIZE;
const panelH = tilesDown * TILE_SIZE;
const gapPx = GAP_TILES * TILE_SIZE;

const canvas = createCanvas(
  (panelW * THEMES.length + gapPx * (THEMES.length - 1)) * scale,
  panelH * scale,
);
const ctx = canvas.getContext('2d');
ctx.fillStyle = GAP_COLOR;
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.scale(scale, scale);
const gameCtx = asGameContext(ctx);

THEMES.forEach((theme, index) => {
  setDungeonFloorTheme(theme);
  gameCtx.save();
  gameCtx.translate(index * (panelW + gapPx), 0);
  renderCanvas(gameCtx, structure, TILE_SIZE, 0, 0, panelW, panelH);
  renderDecorationsOverlay(gameCtx, structure, TILE_SIZE, 0, 0, panelW, panelH);
  gameCtx.restore();
});

writePreviewPng(outPath, canvas.toBuffer('image/png'));
console.log(`${outPath}: wall cases, ${THEMES.join(' | ')}, at ${scale}x`);
