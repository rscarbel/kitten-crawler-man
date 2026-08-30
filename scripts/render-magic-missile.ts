#!/usr/bin/env tsx
/**
 * The Magic Missile review harness.
 *
 * The art is transparent and almost entirely additive light, so looking at a
 * cell on white shows a pale smudge and says nothing about how it reads in a
 * dungeon. This lays every frame of every band over a dark dungeon-ish floor,
 * one contact sheet per figure, which is the only way to judge the effect
 * without a browser.
 *
 * The gates run first, before the contact sheet is allocated: a sheet this size
 * is a tens-of-megapixel allocation, and measuring the art on the far side of
 * one has produced spurious failures on other figures.
 *
 *   npm run render:magic-missile
 *   npx tsx scripts/render-magic-missile.ts --out=missiles.png
 */

import { createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { magicMissileGateFailures } from './gates-magic-missile.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  MAGIC_MISSILE_EXPLOSION_FIGURE,
  MAGIC_MISSILE_PROJECTILE_FIGURE,
} from '../src/sprites/art/magicMissileFigure.js';

const LABEL_HEIGHT = 22;
const LABEL_FONT = '14px sans-serif';
const LABEL_COLOR = '#f2ede4';
const CHECKER = 32;
const FLOOR_LIGHT = '#3a3630';
const FLOOR_DARK = '#2c2924';
const SECTION_GAP = 24;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

// A painter composing on a scratch surface reaches `document.createElement`.
installCanvasGlobals();

reportFigureGates('magic missile', magicMissileGateFailures());

interface Section {
  readonly def: FigureDef;
  readonly caption: string;
}

const SECTIONS: readonly Section[] = [
  { def: MAGIC_MISSILE_PROJECTILE_FIGURE, caption: 'projectile' },
  { def: MAGIC_MISSILE_EXPLOSION_FIGURE, caption: 'impact' },
];

function bandHeight(def: FigureDef): number {
  return LABEL_HEIGHT + def.frameHeight;
}

function widestFrameCount(def: FigureDef): number {
  let widest = 0;
  for (const [, declared] of def.states) widest = Math.max(widest, declared.frames);
  return widest;
}

const width = Math.max(
  ...SECTIONS.map((section) => widestFrameCount(section.def) * section.def.frameWidth),
);
const sectionHeights = SECTIONS.map((section) => section.def.states.size * bandHeight(section.def));
const height = sectionHeights.reduce((total, own) => total + own, 0) + SECTION_GAP;

const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

for (let y = 0; y < height; y += CHECKER) {
  for (let x = 0; x < width; x += CHECKER) {
    ctx.fillStyle = (x / CHECKER + y / CHECKER) % 2 === 0 ? FLOOR_DARK : FLOOR_LIGHT;
    ctx.fillRect(x, y, CHECKER, CHECKER);
  }
}

function label(text: string, x: number, y: number): void {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(text, x + 6, y + LABEL_HEIGHT - 6);
}

let sectionTop = 0;
SECTIONS.forEach((section, index) => {
  const { def } = section;
  let row = 0;
  for (const [state] of def.states) {
    const bandTop = sectionTop + row * bandHeight(def);
    label(`${state} — ${section.caption}`, 0, bandTop);
    ctx.drawImage(bakeFigureSheet(def, [state]).canvas, 0, bandTop + LABEL_HEIGHT);
    row++;
  }
  sectionTop += sectionHeights[index] + SECTION_GAP;
});

const outPath = parseFlag('out', `${PREVIEW_DIR}/magic-missile-review.png`);
const writtenPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
console.log(`Wrote ${writtenPath} (${width}×${height}px)`);
