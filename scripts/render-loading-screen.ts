#!/usr/bin/env tsx
/**
 * Review renders of the loading screen at several progress values and viewport
 * sizes, into `preview/loading-screen/`.
 *
 * Drawn through the same `drawLoadingScreen` the game calls, at a device pixel
 * ratio of 2 — what most players' screens run at — so what is judged here is
 * the screen as shipped rather than a mock of it.
 *
 *   npm run render:loading-screen
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

installCanvasGlobals();

const { drawLoadingScreen } = await import('../src/ui/LoadingScreen.js');
const { level3 } = await import('../src/levels/level3.js');

const DEVICE_PIXEL_RATIO = 2;
const OUT_DIR = `${PREVIEW_DIR}/loading-screen`;

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Viewport[] = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'small-phone', width: 320, height: 568 },
];

interface Moment {
  readonly name: string;
  readonly progress: number;
  readonly status: string;
  /** Animation clock, spread so each render catches the shimmer and motes somewhere different. */
  readonly timeMs: number;
}

const MOMENTS: readonly Moment[] = [
  { name: 'start', progress: 0.04, status: 'Painting the scenery', timeMs: 400 },
  { name: 'middle', progress: 0.57, status: 'Gathering the locals', timeMs: 5300 },
  { name: 'done', progress: 1, status: 'Ready', timeMs: 11800 },
];

const tips = level3.arrivalLoadingScreen?.tips ?? [];

for (const viewport of VIEWPORTS) {
  for (const [index, moment] of MOMENTS.entries()) {
    const canvas = createCanvas(
      viewport.width * DEVICE_PIXEL_RATIO,
      viewport.height * DEVICE_PIXEL_RATIO,
    );
    const nodeCtx = canvas.getContext('2d');
    nodeCtx.scale(DEVICE_PIXEL_RATIO, DEVICE_PIXEL_RATIO);
    drawLoadingScreen(
      asGameContext(nodeCtx),
      {
        kicker: `Floor ${level3.floorNumber}`,
        title: level3.name,
        progress: moment.progress,
        status: moment.status,
        tip: tips[index % Math.max(1, tips.length)],
        timeMs: moment.timeMs,
      },
      viewport.width,
      viewport.height,
    );
    const out = writePreviewPng(
      `${OUT_DIR}/${viewport.name}-${moment.name}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(`wrote ${out}`);
  }
}
