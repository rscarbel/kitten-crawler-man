/**
 * Headless review harness for the Lich's two runtime-drawn battle hazards.
 *
 * Neither one is baked, so there is no sheet to inspect. Both are also judged on
 * things a zoomed still cannot show: the fire wave lives or dies on whether a
 * *row* of segments reads as one wall, and the falling orb on whether a green
 * dot the size of a thumbnail still reads as an incoming object. So every strip
 * here is drawn at the real 32-pixel tile first, and the magnified view under it
 * is nearest-neighbour — a smoothed enlargement invents detail that is not
 * there and is how art ships that nobody can read in play.
 *
 *   npx tsx scripts/render-lich-hazards.ts --out=hazards.png
 *   npx tsx scripts/render-lich-hazards.ts --zoom=8 --only=orb
 *
 * Like `render-smush-blast.ts`, this imports game modules written against
 * browser types and hands them a node-canvas context, so it sits outside
 * `tsconfig.scripts.json` with the other harnesses that need that bridge.
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { drawFireWave } from '../src/sprites/fireWaveSprite.js';
import { drawLichOrb } from '../src/sprites/lichOrbSprite.js';

// The flame stamps are baked into off-screen surfaces the moment the first
// segment is drawn, and that path reaches for `document`.
installCanvasGlobals();

/** Matches TILE_SIZE in src/core/constants.ts. */
const TILE = 32;
/** A room's worth of wall, which is the only width the seams can be judged at. */
const ROOM_TILES = 14;
/** Phases sampled across one loop of the flame. */
const WAVE_PHASES = [0, 0.17, 0.34, 0.5, 0.67, 0.84];
const ORB_PROGRESS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
/** Tiles of headroom above the wall's base row, for the licks that clear it. */
const WAVE_HEADROOM_TILES = 2;
/** Tall enough to hold the whole fall: the orb launches 3.4 tiles up. */
const ORB_CELL_TILES = 5;

const DEFAULT_ZOOM = 6;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
const LABEL_HEIGHT = 18;
const FLOOR_DARK = '#3a3630';
const FLOOR_LIGHT = '#454037';
const LABEL_COLOR = '#f2ede4';
const LABEL_FONT = '12px sans-serif';

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

const requestedZoom = Number(parseFlag('zoom', String(DEFAULT_ZOOM)));
const zoom = Math.min(
  MAX_ZOOM,
  Math.max(MIN_ZOOM, Number.isFinite(requestedZoom) ? requestedZoom : DEFAULT_ZOOM),
);
const outPath = resolve(parseFlag('out', 'lich-hazards.png'));

const HAZARDS = ['wave', 'orb'] as const;
type Hazard = (typeof HAZARDS)[number];

function parseOnly(): readonly Hazard[] {
  const requested = parseFlag('only', '');
  if (requested === '') return HAZARDS;
  const match = HAZARDS.find((hazard) => hazard === requested);
  if (match === undefined) throw new Error(`--only must be one of ${HAZARDS.join(', ')}`);
  return [match];
}

const shown = parseOnly();
const showsWave = shown.includes('wave');
const showsOrb = shown.includes('orb');

const waveStripWidth = ROOM_TILES * TILE;
const waveStripHeight = (WAVE_HEADROOM_TILES + 1) * TILE;
const orbStripWidth = ORB_PROGRESS.length * ORB_CELL_TILES * TILE;
const orbStripHeight = ORB_CELL_TILES * TILE;

const stripWidth = Math.max(showsWave ? waveStripWidth : 0, showsOrb ? orbStripWidth : 0);
const waveBandHeight = showsWave ? waveStripHeight * WAVE_PHASES.length : 0;
const stripHeight = waveBandHeight + (showsOrb ? orbStripHeight : 0);

const strip = createCanvas(stripWidth, stripHeight);
const stripCtx = strip.getContext('2d');
// The bridge every runtime-draw harness needs, and the reason this file is not
// in `tsconfig.scripts.json`: node-canvas's context implements the same drawing
// API under a nominally different type, and there is nothing to narrow.
const gameCtx: CanvasRenderingContext2D = stripCtx as unknown as CanvasRenderingContext2D;

function paintFloor(x: number, y: number, width: number, height: number): void {
  for (let ty = 0; ty * TILE < height; ty++) {
    for (let tx = 0; tx * TILE < width; tx++) {
      stripCtx.fillStyle = (tx + ty) % 2 === 0 ? FLOOR_DARK : FLOOR_LIGHT;
      stripCtx.fillRect(x + tx * TILE, y + ty * TILE, TILE, TILE);
    }
  }
}

paintFloor(0, 0, stripWidth, stripHeight);

if (showsWave) {
  WAVE_PHASES.forEach((phase, row) => {
    const burningRowY = row * waveStripHeight + WAVE_HEADROOM_TILES * TILE;
    for (let tile = 0; tile < ROOM_TILES; tile++) {
      drawFireWave(gameCtx, tile * TILE, burningRowY, TILE, phase);
    }
  });
}

if (showsOrb) {
  ORB_PROGRESS.forEach((progress, index) => {
    const cell = ORB_CELL_TILES * TILE;
    drawLichOrb(gameCtx, index * cell + cell / 2, waveBandHeight + cell - TILE / 2, TILE, progress);
  });
}

const canvas = createCanvas(stripWidth * zoom, (stripHeight + LABEL_HEIGHT) * zoom);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.drawImage(strip, 0, 0, stripWidth, stripHeight, 0, 0, canvas.width, stripHeight * zoom);
ctx.fillStyle = FLOOR_DARK;
ctx.fillRect(0, stripHeight * zoom, canvas.width, LABEL_HEIGHT * zoom);
ctx.fillStyle = LABEL_COLOR;
ctx.font = LABEL_FONT;
ctx.fillText(
  `${shown.join(' + ')} — ${TILE}px tile at ${zoom}× nearest-neighbour`,
  LABEL_HEIGHT / 2,
  stripHeight * zoom + LABEL_HEIGHT,
);

writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${zoom}× nearest-neighbour)`);
