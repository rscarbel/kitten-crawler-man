#!/usr/bin/env tsx
/**
 * Review harness for the town casts' motion: the skyfowl walk and run in all
 * three views, a travelling strip that lays each walk frame down where the
 * runtime carries it (so a planted foot that holds its ground shows as one
 * foot, and a skate as a smear), and every Desperado Club dance routine for
 * both casts — each enlarged and at the 32px tile.
 *
 * Runs `gates:cast-motion` first and exits non-zero if they fail.
 *
 *   npm run render:cast-motion
 *
 * Output lands in `preview/cast-motion/`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import {
  SKYFOWL_CAST_TILE_SCALE,
  castRowsFor,
  skyfowlCastFigure,
  skyfowlWalkCyclePx,
} from '../src/sprites/art/skyfowlCastFigure.js';
import type { SkyfowlLookId } from '../src/sprites/art/skyfowl/cast.js';
import { DANCE_STYLES, danceStateName } from '../src/sprites/art/danceStyles.js';
import { townCastOutfitFigure } from '../src/sprites/art/townCastFigure.js';
import { clubDancerLook } from '../src/sprites/person/clubCastLooks.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { bakeFigureCell } from './figureSheet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { castMotionGateFailures } from './gates-cast-motion.js';

const OUT_DIR = `${PREVIEW_DIR}/cast-motion`;
const ENLARGED = 2;
const IN_GAME = TILE_SIZE / SKYFOWL_CAST_TILE_SCALE;
const BACKDROP = '#4a4e58';
const GROUND_LINE = 'rgba(255, 90, 90, 0.6)';
const LABEL_COLOUR = '#e8e8e8';
const LABEL_FONT = '12px sans-serif';
const LABEL_GUTTER = 90;
const LABEL_INSET = 4;
const TRAVEL_FRAME_ALPHA = 0.35;

const WALK_LOOKS: readonly SkyfowlLookId[] = [
  'merchant_hawkbrown_standard',
  'guard_hawkbrown_standard',
  'fledgling_hawkbrown',
  'tough_hawkbrown_standard',
];
const DANCER_LOOKS: readonly SkyfowlLookId[] = [
  'dancer_sparrowfleck_slight',
  'dancer_goldenbarred_standard',
];

/** Rows laid out one per line, every frame, at `scale`, with the row name in a left gutter. */
function sheet(def: FigureDef, states: readonly string[], scale: number): Canvas {
  const columns = Math.max(...states.map((state) => def.states.get(state)?.frames ?? 0));
  const cellW = Math.ceil(def.frameWidth * scale);
  const cellH = Math.ceil(def.frameHeight * scale);
  const canvas = createCanvas(LABEL_GUTTER + columns * cellW, states.length * cellH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = scale < 1;
  states.forEach((state, row) => {
    ctx.fillStyle = LABEL_COLOUR;
    ctx.font = LABEL_FONT;
    ctx.fillText(state, LABEL_INSET, row * cellH + cellH / 2);
    const frames = def.states.get(state)?.frames ?? 0;
    for (let frame = 0; frame < frames; frame++) {
      const x = LABEL_GUTTER + frame * cellW;
      ctx.drawImage(bakeFigureCell(def, state, frame), x, row * cellH, cellW, cellH);
    }
    const lowestSole = def.tileY + def.tileScale;
    ctx.fillStyle = GROUND_LINE;
    ctx.fillRect(LABEL_GUTTER, row * cellH + Math.round(lowestSole * scale), columns * cellW, 1);
  });
  return canvas;
}

/**
 * One stride of the profile walk, each frame drawn faintly where the runtime
 * has carried the figure by then: the ground per frame is the look's own
 * cycle length over its frame count. A foot that holds its ground stacks into
 * one sharp foot; one that skates smears along the floor.
 */
function travellingStrip(id: SkyfowlLookId): Canvas {
  const def = skyfowlCastFigure(id);
  const frames = def.states.get('walk_side')?.frames ?? 0;
  const cellPxPerWorldPx = SKYFOWL_CAST_TILE_SCALE / TILE_SIZE;
  const stepCellPx = (skyfowlWalkCyclePx(id, TILE_SIZE) / frames) * cellPxPerWorldPx;
  const width = Math.ceil(def.frameWidth + stepCellPx * frames);
  const canvas = createCanvas(width * ENLARGED, def.frameHeight * ENLARGED);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = TRAVEL_FRAME_ALPHA;
  for (let frame = 0; frame < frames; frame++) {
    ctx.drawImage(
      bakeFigureCell(def, 'walk_side', frame),
      frame * stepCellPx * ENLARGED,
      0,
      def.frameWidth * ENLARGED,
      def.frameHeight * ENLARGED,
    );
  }
  return canvas;
}

function write(name: string, canvas: Canvas): void {
  const path = writePreviewPng(`${OUT_DIR}/${name}.png`, canvas.toBuffer('image/png'));
  console.log(`  wrote ${path}`);
}

const failures = castMotionGateFailures();
for (const failure of failures) console.error(`  FAIL ${failure}`);
if (failures.length > 0) process.exitCode = 1;
else console.log('  ok   cast-motion gates');

for (const id of WALK_LOOKS) {
  const def = skyfowlCastFigure(id);
  const states = castRowsFor(id)
    .filter((row) => row.role === 'walk' || row.role === 'run')
    .map((row) => row.name);
  write(`walk-${id}`, sheet(def, states, ENLARGED));
  write(`walk-${id}-32px`, sheet(def, states, IN_GAME));
  write(`travel-${id}`, travellingStrip(id));
}

const danceStates = DANCE_STYLES.map(danceStateName);
for (const id of DANCER_LOOKS) {
  const def = skyfowlCastFigure(id);
  write(`dance-${id}`, sheet(def, danceStates, ENLARGED));
  write(`dance-${id}-32px`, sheet(def, danceStates, IN_GAME));
}
const humanDancer = townCastOutfitFigure(clubDancerLook());
write('dance-club_dancer', sheet(humanDancer, danceStates, ENLARGED));
write('dance-club_dancer-32px', sheet(humanDancer, danceStates, IN_GAME));
