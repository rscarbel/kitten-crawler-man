#!/usr/bin/env tsx
/**
 * Review PNGs of the sewer as the game draws it, through the real
 * `BuildingInteriorScene` behind the storm drain:
 *
 *  - each section whole, its valves untouched and then every valve turned,
 *    so the water each valve moves can be compared side by side;
 *  - one in-game-scale screenshot at each of the guide's stops, with the
 *    party standing there.
 *
 *   npm run render:sewer
 *
 * Writes to `preview/missing-cats/sewer/`.
 */

import { installBrowserShim } from './browserShim.js';

const SCREEN = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
installBrowserShim(SCREEN);

const { createCanvas } = await import('canvas');
const { asGameContext } = await import('./nodeGameContext.js');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { planSewer } = await import('../src/map/sewer/sewerPlan.js');
const { SEWER_VALVE_IDS } = await import('../src/map/sewer/sewerLayouts.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
useDevPlayerIdentity();
const { enterSewer } = await import('./sewerInteriorHarness.js');

const OUT_DIR = `${PREVIEW_DIR}/missing-cats/sewer`;
/** Frames run before a shot, so the arrival card has faded and the water has settled. */
const SETTLE_FRAMES = 200;

const written: string[] = [];
const plan = planSewer();

for (const section of plan.sections) {
  const worldW = section.grid.width * TILE_SIZE;
  const worldH = section.grid.height * TILE_SIZE;
  for (const [label, settled] of [
    ['as-built', []],
    ['valves-turned', SEWER_VALVE_IDS],
  ] as const) {
    setViewportSize(SCREEN.width, SCREEN.height);
    const arrivalCanvas = createCanvas(SCREEN.width, SCREEN.height);
    const harness = await enterSewer(asGameContext(arrivalCanvas.getContext('2d')), { settled });
    harness.placeAt(harness.human, section.ladder);
    harness.placeAt(harness.cat, section.ladder);
    harness.step(SETTLE_FRAMES);
    setViewportSize(worldW, worldH);
    const canvas = createCanvas(worldW, worldH);
    const ctx = asGameContext(canvas.getContext('2d'));
    const { scene } = harness;
    const map = scene['map'];
    const encounter = scene['encounter'];
    const roster = scene['world'].roster;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, worldW, worldH);
    map.renderCanvas(ctx, 0, 0, worldW, worldH);
    encounter?.renderWorld?.(ctx, 0, 0, harness.human);
    const figures = [
      ...roster.mobs.filter((mob) => mob.belongsInMobGrid),
      harness.human,
      harness.cat,
    ].sort((first, second) => first.y - second.y);
    for (const figure of figures) figure.render(ctx, 0, 0, TILE_SIZE);
    encounter?.renderDarkness?.(ctx, 0, 0);
    written.push(
      writePreviewPng(`${OUT_DIR}/${section.layout.id}-${label}.png`, canvas.toBuffer('image/png')),
    );
  }

  setViewportSize(SCREEN.width, SCREEN.height);
  const screenCanvas = createCanvas(SCREEN.width, SCREEN.height);
  const screen = asGameContext(screenCanvas.getContext('2d'));
  const harness = await enterSewer(screen);
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
    harness.step(1);
    harness.render();
  }
  for (const stop of section.guideStops) {
    harness.placeAt(harness.human, stop.tile);
    harness.placeAt(harness.cat, { x: stop.tile.x - 1, y: stop.tile.y });
    harness.step(1);
    harness.render();
    written.push(
      writePreviewPng(
        `${OUT_DIR}/${section.layout.id}-stop-${stop.def.id}.png`,
        screenCanvas.toBuffer('image/png'),
      ),
    );
  }
}

for (const path of written) console.log(`wrote ${path}`);
