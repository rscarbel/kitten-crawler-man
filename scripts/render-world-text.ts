#!/usr/bin/env tsx
/**
 * A specimen sheet of the world painters in `src/ui/world/`: every world text
 * style, the bars and a caption plate, each over a floor-coloured backdrop, for
 * an eye check after touching `theme/worldInk.ts` or the painters.
 *
 * Run: npm run render:world-text   (writes preview/world-text.png)
 */

import { createCanvas } from 'canvas';
import { join } from 'node:path';

import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { worldPlate, worldBar } from '../src/ui/world/worldShapes.js';
import { worldText, type WorldTextOptions } from '../src/ui/world/worldText.js';
import { WORLD_TEXT } from '../src/ui/theme/worldInk.js';

const CELL_W = 340;
const CELL_H = 64;
const LABEL_W = 150;
const ANCHOR_X = 20;
const ANCHOR_Y = 18;
const BAR_W = 200;
const BAR_H = 8;
const PLATE_W = 220;
const PLATE_H = 34;
const WRAP_WIDTH = 220;
const WRAPPED_LINE_HEIGHT = 13;
const SMALL_TEXT_SIZE = 11;
const WHISPER_TEXT_SIZE = 13;
const FADED_ALPHA = 0.6;
const BACKDROP = '#637032';
const CAPTION_COLOR = '#f4efe4';
const MISS_COLOR = '#cbd5e1';
const IMMUNE_GLOW = '#bfe3ff';

type Painter = (ctx: CanvasRenderingContext2D) => void;

interface Case {
  readonly name: string;
  readonly paint: Painter;
}

function textCase(name: string, content: string, opts: Omit<WorldTextOptions, 'x' | 'y'>): Case {
  return {
    name,
    paint: (ctx) => worldText(ctx, content, { x: ANCHOR_X, y: ANCHOR_Y, ...opts }),
  };
}

const CENTRE_X = CELL_W / 2;
const HALF_HP = 0.62;
const BUILD_DONE = 0.35;

const CASES: readonly Case[] = [
  ...Object.entries(WORLD_TEXT).map(([style, look]) =>
    textCase(style, `${style}: Goblin archer +125`, look),
  ),
  textCase('hint, outlined', 'Cost: 4 boards, 2 rope.', { style: 'hint', outline: true }),
  textCase('title + glow', 'IMMUNE', { style: 'title', glow: IMMUNE_GLOW }),
  {
    name: 'centred, alpha',
    paint: (ctx) =>
      worldText(ctx, 'MISS', {
        style: 'value',
        x: CENTRE_X,
        y: ANCHOR_Y,
        size: SMALL_TEXT_SIZE,
        color: MISS_COLOR,
        alpha: FADED_ALPHA,
        align: 'center',
        outline: true,
      }),
  },
  textCase('wrapped, centred', 'Press E to repair the bell tower before the next wave arrives.', {
    style: 'label',
    width: WRAP_WIDTH,
    align: 'center',
    lineHeight: WRAPPED_LINE_HEIGHT,
  }),
  textCase('shadow, italic', 'a whisper', { size: WHISPER_TEXT_SIZE, italic: true, shadow: true }),
  textCase('strikethrough', 'Old advice', { style: 'muted', strikethrough: true }),
  textCase('tabular', '1:11  10:08', { style: 'value', tabular: true }),
  {
    name: 'hp bar',
    paint: (ctx) =>
      worldBar(
        ctx,
        { x: ANCHOR_X, y: ANCHOR_Y, w: BAR_W, h: BAR_H },
        { style: 'hp', value: HALF_HP },
      ),
  },
  {
    name: 'build bar',
    paint: (ctx) =>
      worldBar(
        ctx,
        { x: ANCHOR_X, y: ANCHOR_Y, w: BAR_W, h: BAR_H },
        { style: 'build', value: BUILD_DONE },
      ),
  },
  {
    name: 'caption plate',
    paint: (ctx) => {
      worldPlate(
        ctx,
        { x: ANCHOR_X, y: ANCHOR_Y, w: PLATE_W, h: PLATE_H },
        { style: 'captionReady' },
      );
      worldText(ctx, 'Ready to build', {
        x: ANCHOR_X + PLATE_W / 2,
        y: ANCHOR_Y + PLATE_H / 2,
        align: 'center',
        style: 'ready',
      });
    },
  },
];

function main(): void {
  const sheetW = LABEL_W + CELL_W;
  const sheetH = CELL_H * CASES.length;
  const sheet = createCanvas(sheetW, sheetH);
  const ctx = asGameContext(sheet.getContext('2d'));
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, sheetW, sheetH);

  CASES.forEach((testCase, index) => {
    const top = index * CELL_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, top, CELL_W, CELL_H);
    ctx.clip();
    ctx.translate(LABEL_W, top);
    testCase.paint(ctx);
    ctx.restore();
    worldText(ctx, testCase.name, {
      style: 'label',
      x: ANCHOR_X / 2,
      y: top + ANCHOR_Y,
      color: CAPTION_COLOR,
    });
  });

  const out = writePreviewPng(join(PREVIEW_DIR, 'world-text.png'), sheet.toBuffer('image/png'));
  console.log(`${CASES.length} specimens\nwrote ${out}`);
}

main();
