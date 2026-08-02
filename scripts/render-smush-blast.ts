/**
 * Headless review harness for the Smush blast.
 *
 * The blast is drawn at runtime rather than baked, so there is no sheet to
 * inspect; this runs the game's own `drawSmushBlast` over a checkerboard floor
 * at a spread of ages and radii, which is the only way to judge the effect
 * without a browser (and the browser harness cannot drive this game).
 *
 *   npx tsx scripts/render-smush-blast.ts --out=blast.png
 *   npx tsx scripts/render-smush-blast.ts --radius=256 --out=capped.png
 *
 * Like `render-town.ts`, this imports a game module written against browser
 * types and hands it a node-canvas context, so it sits outside
 * `tsconfig.scripts.json` with the other harnesses that need that bridge.
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drawSmushBlast, SMUSH_BLAST_FRAMES } from '../src/sprites/smushBlast.js';

/** Level 1 is 3.5 tiles of outer radius; the level cap is 8. */
const LEVEL_ONE_RADIUS_PX = 112;
const CAPPED_RADIUS_PX = 256;
const FULL_POWER_RADIUS_PX = CAPPED_RADIUS_PX;

const AGES = [0, 3, 6, 10, 14, 20, 28, 38];
/**
 * The whole point of the effect is that the ring stops exactly on the damage
 * radius, so the cell has to be big enough to contain that radius — sized to a
 * constant, the capped blast is cropped before it gets there.
 */
const CELL_MARGIN_PX = 48;
const LABEL_HEIGHT = 20;
const CHECKER = 32;
const FLOOR_LIGHT = '#4a4238';
const FLOOR_DARK = '#3b342c';
const LABEL_COLOR = '#f2ede4';
const LABEL_FONT = '13px sans-serif';
/** Fixed so two runs of the harness are comparable. */
const REVIEW_SEED = 0.42;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

const radiusOverride = Number(parseFlag('radius', '0'));
const radii =
  Number.isFinite(radiusOverride) && radiusOverride > 0
    ? [radiusOverride]
    : [LEVEL_ONE_RADIUS_PX, CAPPED_RADIUS_PX];

const CELL = Math.max(...radii) * 2 + CELL_MARGIN_PX;
const width = CELL * AGES.length;
const height = (CELL + LABEL_HEIGHT) * radii.length;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');
const gameCtx = ctx as unknown as CanvasRenderingContext2D;

for (let y = 0; y < height; y += CHECKER) {
  for (let x = 0; x < width; x += CHECKER) {
    const dark = (x / CHECKER + y / CHECKER) % 2 === 0;
    ctx.fillStyle = dark ? FLOOR_DARK : FLOOR_LIGHT;
    ctx.fillRect(x, y, CHECKER, CHECKER);
  }
}

ctx.font = LABEL_FONT;
radii.forEach((radius, row) => {
  const top = row * (CELL + LABEL_HEIGHT);
  AGES.forEach((age, col) => {
    const left = col * CELL;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top + LABEL_HEIGHT, CELL, CELL);
    ctx.clip();
    drawSmushBlast(gameCtx, {
      cx: left + CELL / 2,
      cy: top + LABEL_HEIGHT + CELL / 2,
      damageRadius: radius,
      age,
      seed: REVIEW_SEED,
      fullPower: radius >= FULL_POWER_RADIUS_PX,
    });
    ctx.restore();
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`r=${radius}px  frame ${age}/${SMUSH_BLAST_FRAMES}`, left + 8, top + 14);
  });
});

const outPath = resolve(parseFlag('out', 'smush-blast.png'));
writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`Wrote ${outPath} (${width}×${height}px)`);
