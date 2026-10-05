/**
 * Review harness for the run-complete screen: bakes its surface through a real
 * `UiRoot` at a desktop window, a portrait phone and a landscape phone, each
 * mid count-up and settled, into `preview/run-complete/` (or
 * `--out-dir=<dir>`). The screen draws itself from a `RunSummary`, so a sample
 * one stands in for a finished run; a second, leaner summary checks the
 * no-Mongo, no-kills layout.
 *
 *   npx tsx scripts/render-run-complete.ts
 */

import { createCanvas } from 'canvas';
import { join } from 'node:path';
import { UiRoot } from '../src/ui/core/UiRoot.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';
import type { Density } from '../src/ui/theme/tokens.js';
import { RunCompleteScreen, type RunSummary } from '../src/ui/screens/dialogs/RunCompleteScreen.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

/** Render frames into the count-up at which the "mid" shot is taken. */
const MID_COUNT_UP_FRAME = 95;
/** Render frames after which every row has settled and the buttons are up. */
const SETTLED_FRAME = 420;
const FRAME_MS = 16;
const FRAMES_PER_MINUTE = 3600;
const FULL_RUN_MINUTES = 327;
const BACKDROP_COLOUR = '#1f2937';

const viewports: ReadonlyArray<{ name: string; w: number; h: number; density: Density }> = [
  { name: 'desktop', w: 1280, h: 800, density: 'pointer' },
  { name: 'phone-portrait', w: 375, h: 667, density: 'touch' },
  { name: 'phone-landscape', w: 667, h: 375, density: 'touch' },
];

const FULL_RUN: RunSummary = {
  framesPlayed: FULL_RUN_MINUTES * FRAMES_PER_MINUTE,
  deaths: 7,
  damageDealt: 184_302,
  damageTaken: 21_577,
  potionsUsed: 64,
  goldEarned: 12_840,
  achievementsUnlocked: 38,
  achievementsTotal: 52,
  humanLevel: 24,
  catLevel: 23,
  mongoLevel: 12,
  totalKills: 1_412,
  bossesDefeated: 11,
  hirelingsHired: 3,
  hirelingsLost: 1,
  topKills: [
    ['Goblin', 402],
    ['Rat-kin Skirmisher', 211],
    ['Cockroach', 188],
    ['Krasue', 96],
    ['Grotesque Spider Hatchling', 71],
  ],
};

const LEAN_RUN: RunSummary = {
  ...FULL_RUN,
  mongoLevel: null,
  totalKills: 0,
  topKills: [],
  hirelingsHired: 0,
  hirelingsLost: 0,
};

const outFlag = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir =
  outFlag === undefined ? join(PREVIEW_DIR, 'run-complete') : outFlag.slice('--out-dir='.length);

function bake(summary: RunSummary, label: string): void {
  for (const viewport of viewports) {
    let clock = 0;
    const viewportInput = (): ViewportInput => ({
      cssWidth: viewport.w,
      cssHeight: viewport.h,
      density: viewport.density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    });
    const root = new UiRoot({
      audio: null,
      viewport: viewportInput,
      now: () => clock,
      warn: () => undefined,
    });
    const screen = new RunCompleteScreen();
    root.mount(screen.surface());
    screen.activate(summary, { onKeepExploring: () => undefined, onMainMenu: () => undefined });
    const canvas = createCanvas(viewport.w, viewport.h);
    const ctx = asGameContext(canvas.getContext('2d'));
    for (let frame = 1; frame <= SETTLED_FRAME; frame++) {
      clock += FRAME_MS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKDROP_COLOUR;
      ctx.fillRect(0, 0, viewport.w, viewport.h);
      root.frame(ctx);
      if (frame === MID_COUNT_UP_FRAME || frame === SETTLED_FRAME) {
        const stage = frame === SETTLED_FRAME ? 'settled' : 'mid';
        const path = writePreviewPng(
          join(outDir, `${label}-${viewport.name}-${stage}.png`),
          canvas.toBuffer('image/png'),
        );
        console.log(path);
      }
    }
  }
}

installCanvasGlobals();
bake(FULL_RUN, 'full');
bake(LEAN_RUN, 'lean');
