/**
 * Times the slot machine's MEGA WIN celebration frame by frame on a phone held
 * upright, rendered through the machine's real surface at a phone's device
 * pixel ratio, so the coin shower, banner, bulbs and reels are all on screen.
 * Reports only; node-canvas is a software rasteriser, so the numbers are an
 * upper bound on what a phone's GPU canvas pays.
 *
 * Run: npm run bench:slots            (MEGA WIN)
 *      npm run bench:slots -- idle    (the resting machine, for comparison)
 */
import { createCanvas } from 'canvas';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { UiRoot } from '../src/ui/core/UiRoot.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';
import { openStagedSlots, stageSlots, SLOTS_STAGE_STEP_MS } from '../src/dev/slotsStaging.js';

installCanvasGlobals();

const PHONE_W = 390;
const PHONE_H = 844;
const DEVICE_PIXEL_RATIO = 3;
const WARMUP_FRAMES = 10;
const MEASURED_FRAMES = 240;
const PERCENTILE_95 = 0.95;
const FRAME_BUDGET_MS = 16.7;

const staged = openStagedSlots();
const stage = process.argv[2] === 'idle' ? 'idle' : 'mega-win';
stageSlots(staged, stage);
const viewport = (): ViewportInput => ({
  cssWidth: PHONE_W,
  cssHeight: PHONE_H,
  density: 'touch',
  uiSize: 'medium',
  safeArea: NO_INSETS,
});
const root = new UiRoot({ audio: null, viewport, now: staged.now, warn: () => undefined });
root.mount(staged.host.machineSurface('bench-slots', staged.seat));
const canvas = createCanvas(PHONE_W * DEVICE_PIXEL_RATIO, PHONE_H * DEVICE_PIXEL_RATIO);
const ctx = asGameContext(canvas.getContext('2d'));

const times: number[] = [];
let particlesPeak = 0;
for (let frame = 0; frame < WARMUP_FRAMES + MEASURED_FRAMES; frame++) {
  staged.advance(SLOTS_STAGE_STEP_MS);
  const started = performance.now();
  ctx.setTransform(DEVICE_PIXEL_RATIO, 0, 0, DEVICE_PIXEL_RATIO, 0, 0);
  root.frame(ctx);
  const elapsed = performance.now() - started;
  particlesPeak = Math.max(particlesPeak, staged.host.motion.particles.length);
  if (frame >= WARMUP_FRAMES) times.push(elapsed);
}
times.sort((a, b) => a - b);
const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
const p95 = times[Math.floor(times.length * PERCENTILE_95)] ?? mean;
const worst = times[times.length - 1] ?? mean;
const stillCelebrating = staged.host.motion.celebration !== null;
console.log(
  `${stage} on ${PHONE_W}x${PHONE_H} @${DEVICE_PIXEL_RATIO}x: mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, worst ${worst.toFixed(2)} ms over ${MEASURED_FRAMES} frames (budget ${FRAME_BUDGET_MS} ms); peak particles ${particlesPeak}; celebration still running at the end: ${stillCelebrating}`,
);
