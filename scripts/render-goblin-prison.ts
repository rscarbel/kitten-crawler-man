#!/usr/bin/env tsx
/**
 * Review PNGs of the Goblin High Security Prison as the game draws it:
 *
 *  - per layout, the whole prison at several moments of its loop, with the
 *    walls, floor, bars, cover, cells, guards and prisoners, the darkness and
 *    every flashlight cone and spotlight disc cut through it — the shapes
 *    detection reads — written as one strip per layout;
 *  - per layout and section, one in-game-scale screenshot of the real
 *    `BuildingInteriorScene` with the party standing in that section.
 *
 *   npm run render:goblin-prison [-- --difficulty=hard]
 *
 * Writes to `preview/goblin-prison/`.
 */

import { installBrowserShim } from './browserShim.js';

const SCREEN = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
installBrowserShim(SCREEN);

const { createCanvas } = await import('canvas');
const { asGameContext } = await import('./nodeGameContext.js');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { cameraAt, UNZOOMED } = await import('../src/core/rendering/camera.js');
const { PRISON_LAYOUTS } = await import('../src/map/goblinPrisonLayouts.js');
const { isPrisonCrawlerWalkable, rectContainsTile } =
  await import('../src/map/goblinPrisonPlan.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
useDevPlayerIdentity();
const { enterPrison } = await import('./prisonInteriorHarness.js');
type Difficulty = import('../src/core/difficulty/difficultyProfiles.js').Difficulty;

const OUT_DIR = `${PREVIEW_DIR}/goblin-prison`;
/** Moments of the loop drawn per layout, as shares of its cycle. */
const LOOP_PHASES = [0, 0.25, 0.5, 0.75] as const;
/** The overview is drawn at this share of world size. */
const OVERVIEW_SCALE = 0.5;
const OVERVIEW_GAP_PX = 12;
const OVERVIEW_COLUMNS = 2;
/** How far ahead of a guard the catching shot stands the crawler, in tiles. */
const CONE_PROBE_TILES = 2;
/** The suspicion at which the catching shot is taken, and how long it waits for it. */
const CATCHING_SHOWN_SUSPICION = 0.6;
const CATCHING_MAX_FRAMES = 240;
/** Frames drawn after arriving so the loading screen has faded before a shot. */
const ARRIVAL_FADE_FRAMES = 90;

function difficultyArg(): Difficulty {
  const arg = process.argv.find((value) => value.startsWith('--difficulty='));
  const value = arg?.slice('--difficulty='.length);
  return value === 'easy' || value === 'hard' ? value : 'normal';
}

setViewportSize(SCREEN.width, SCREEN.height);
const screenCanvas = createCanvas(SCREEN.width, SCREEN.height);
const screen = asGameContext(screenCanvas.getContext('2d'));
const difficulty = difficultyArg();
const written: string[] = [];

for (const layout of PRISON_LAYOUTS) {
  const harness = await enterPrison(screen, { layoutId: layout.id, difficulty });
  const { prison, scene } = harness;
  const { grid } = prison.compiled.parsed;
  const worldW = grid.width * TILE_SIZE;
  const worldH = grid.height * TILE_SIZE;
  const panelW = Math.ceil(worldW * OVERVIEW_SCALE);
  const panelH = Math.ceil(worldH * OVERVIEW_SCALE);
  const rows = Math.ceil(LOOP_PHASES.length / OVERVIEW_COLUMNS);
  const strip = createCanvas(
    panelW * OVERVIEW_COLUMNS + OVERVIEW_GAP_PX * (OVERVIEW_COLUMNS - 1),
    panelH * rows + OVERVIEW_GAP_PX * (rows - 1),
  );
  const stripCtx = strip.getContext('2d');
  const world = createCanvas(worldW, worldH);
  const worldCtx = asGameContext(world.getContext('2d'));
  harness.placeAt(harness.human, prison.compiled.parsed.entry);
  harness.placeAt(harness.cat, prison.compiled.parsed.entry);
  const roster = scene['world'].roster;
  const keyFigure = scene['prisonKey']?.sortedFigure() ?? null;

  for (const [index, share] of LOOP_PHASES.entries()) {
    const target = Math.floor(prison.compiled.cycleFrames * share);
    while (prison.loopFrame < target) harness.step(1);
    setViewportSize(worldW, worldH);
    const wholeWorld = cameraAt({ x: 0, y: 0 }, UNZOOMED);
    worldCtx.fillStyle = '#000';
    worldCtx.fillRect(0, 0, worldW, worldH);
    prison.ground.renderGround(worldCtx, wholeWorld);
    const figures = [
      ...prison.roomFigures(wholeWorld),
      ...roster.mobs.filter((mob) => mob.belongsInMobGrid),
      ...(keyFigure === null ? [] : [keyFigure]),
      harness.human,
      harness.cat,
    ].sort((a, b) => a.y - b.y);
    for (const figure of figures) figure.render(worldCtx, 0, 0, TILE_SIZE);
    prison.renderDarkness(worldCtx, wholeWorld);
    prison.renderEffects(worldCtx, wholeWorld);
    setViewportSize(SCREEN.width, SCREEN.height);
    const column = index % OVERVIEW_COLUMNS;
    const row = Math.floor(index / OVERVIEW_COLUMNS);
    stripCtx.drawImage(
      world,
      column * (panelW + OVERVIEW_GAP_PX),
      row * (panelH + OVERVIEW_GAP_PX),
      panelW,
      panelH,
    );
  }
  written.push(
    writePreviewPng(`${OUT_DIR}/${layout.id}-${difficulty}-loop.png`, strip.toBuffer('image/png')),
  );

  for (const section of layout.sections) {
    const { rect } = section;
    const centre = {
      x: Math.floor((rect.x0 + rect.x1) / 2),
      y: Math.floor((rect.y0 + rect.y1) / 2),
    };
    let best = prison.compiled.parsed.entry;
    let bestDistance = Infinity;
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (!isPrisonCrawlerWalkable(grid, x, y) || !rectContainsTile(rect, x, y)) continue;
        const distance = Math.hypot(x - centre.x, y - centre.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, y };
        }
      }
    }
    harness.placeAt(harness.human, best);
    harness.placeAt(harness.cat, best);
    harness.step(1);
    harness.render();
    written.push(
      writePreviewPng(
        `${OUT_DIR}/${layout.id}-${difficulty}-${section.id}.png`,
        screenCanvas.toBuffer('image/png'),
      ),
    );
  }
}

/**
 * A crawler halfway to caught in a spotlight and in a flashlight cone, so the
 * amber a light turns while it fills can be judged at game scale.
 */
for (const layout of PRISON_LAYOUTS) {
  for (const kind of ['spotlight', 'flashlight'] as const) {
    const harness = await enterPrison(screen, { layoutId: layout.id, difficulty });
    const { prison } = harness;
    const followLight = (): void => {
      if (kind === 'spotlight') {
        const spot = prison.compiled.spotlights[0];
        const centre = spot.centreAt(prison.loopFrame + 1);
        harness.human.x = centre.x - TILE_SIZE / 2;
        harness.human.y = centre.y - TILE_SIZE / 2;
        return;
      }
      const guard = prison.guardMobs[0];
      const ahead = TILE_SIZE * CONE_PROBE_TILES;
      harness.human.x = guard.x + Math.cos(guard.facingAngle) * ahead;
      harness.human.y = guard.y + Math.sin(guard.facingAngle) * ahead;
    };
    for (let frame = 0; frame < ARRIVAL_FADE_FRAMES; frame++) harness.render();
    harness.placeAt(harness.cat, prison.compiled.parsed.entry);
    let caughtFrames = 0;
    while (caughtFrames < CATCHING_MAX_FRAMES) {
      followLight();
      harness.step(1);
      caughtFrames++;
      const most = Math.max(...prison.suspicionById().values());
      if (most >= CATCHING_SHOWN_SUSPICION || prison.isCapturing) break;
    }
    harness.render();
    written.push(
      writePreviewPng(
        `${OUT_DIR}/${layout.id}-${difficulty}-catching-${kind}.png`,
        screenCanvas.toBuffer('image/png'),
      ),
    );
  }
}

for (const path of written) console.log(`wrote ${path}`);
