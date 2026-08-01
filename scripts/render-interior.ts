/**
 * Headless renderer for a town building interior — the sibling of
 * `render-town.ts` and `render-dungeon.ts`.
 *
 * It exists because interiors were the one part of the town nothing could show
 * without a browser, which is exactly how they ended up floored in the dungeon's
 * generic tile types without anyone noticing.
 *
 *   npx tsx scripts/render-interior.ts --kind=store --scale=3
 *   npx tsx scripts/render-interior.ts --kind=house --name="The Horned Flagon"
 *   npx tsx scripts/render-interior.ts --kind=tower --floor=1
 */

import { createCanvas, type Canvas } from 'canvas';
import { writeFileSync } from 'node:fs';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { renderCanvas, renderDecorationsOverlay } from '../src/map/TileRenderer.js';
import type { BuildingKind } from '../src/map/town/townPlan.js';

const DEFAULT_KIND = 'store';
const DEFAULT_SCALE = 2;
const DEFAULT_TOWER_FLOOR = 0;
const DEFAULT_OUT = 'interior.png';
/** Length of the `--name=` prefix an argument's value starts after. */
const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + ARG_PREFIX_LENGTH), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

const KINDS: ReadonlyArray<BuildingKind> = ['store', 'house', 'tower', 'restaurant', 'club'];

function parseKind(raw: string): BuildingKind {
  const match = KINDS.find((k) => k === raw);
  if (match === undefined) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
  return match;
}

const kind = parseKind(stringArg('kind', DEFAULT_KIND));
const buildingName = stringArg('name', '');
const towerFloor = intArg('floor', DEFAULT_TOWER_FLOOR);
const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);

await loadGameSpritesInNode();

const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
map.generateInterior(kind, towerFloor, buildingName);

const tilesW = map.structure[0].length;
const tilesH = map.structure.length;
const viewW = tilesW * TILE_SIZE;
const viewH = tilesH * TILE_SIZE;

const canvas: Canvas = createCanvas(viewW * scale, viewH * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
// node-canvas implements the same drawing surface the game's renderers are
// written against, but not the DOM's `CanvasRenderingContext2D` nominal type.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const gameCtx = ctx as unknown as CanvasRenderingContext2D;

renderCanvas(gameCtx, map.structure, TILE_SIZE, 0, 0, viewW, viewH);
renderDecorationsOverlay(gameCtx, map.structure, TILE_SIZE, 0, 0, viewW, viewH);

writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`${outPath}: ${buildingName || kind} — ${tilesW}x${tilesH} tiles at ${scale}x`);
