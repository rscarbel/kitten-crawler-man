/**
 * Review harness for the run-complete screen: bakes it at a desktop window, a
 * portrait phone and a landscape phone, each mid count-up and settled, into
 * `preview/run-complete/` (or `--out-dir=<dir>`). The screen draws itself from
 * a `RunSummary`, so a sample one stands in for a finished run; a second,
 * leaner summary checks the no-Mongo, no-kills layout.
 *
 *   npx tsx scripts/render-run-complete.ts
 */

import { createCanvas } from 'canvas';
import { join } from 'node:path';
import { setViewportSize } from '../src/core/Viewport.js';
import { RunCompleteScreen, type RunSummary } from '../src/ui/RunCompleteScreen.js';
import { setButtonMouseState } from '../src/ui/Button.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

/** Backing-store pixels per CSS pixel, as a Retina display draws the game. */
const RENDER_SCALE = 2;
/** Render frames into the count-up at which the "mid" shot is taken. */
const MID_COUNT_UP_FRAME = 95;
/** Render frames after which every row has settled and the buttons are up. */
const SETTLED_FRAME = 420;
/** Off-canvas, so no button draws hovered. */
const MOUSE_AWAY = -1000;
const FRAMES_PER_MINUTE = 3600;
const FULL_RUN_MINUTES = 327;

const viewports: ReadonlyArray<{ name: string; w: number; h: number }> = [
  { name: 'desktop', w: 1280, h: 800 },
  { name: 'phone-portrait', w: 375, h: 667 },
  { name: 'phone-landscape', w: 667, h: 375 },
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
    const canvas = createCanvas(viewport.w * RENDER_SCALE, viewport.h * RENDER_SCALE);
    const nodeCtx = canvas.getContext('2d');
    const ctx = asGameContext(nodeCtx);
    setViewportSize(viewport.w, viewport.h);
    const screen = new RunCompleteScreen();
    screen.activate(summary, { onKeepExploring: () => undefined, onMainMenu: () => undefined });
    for (let frame = 1; frame <= SETTLED_FRAME; frame++) {
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, viewport.w, viewport.h);
      setButtonMouseState(MOUSE_AWAY, MOUSE_AWAY);
      screen.render(ctx);
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

bake(FULL_RUN, 'full');
bake(LEAN_RUN, 'lean');
