#!/usr/bin/env tsx
/**
 * Review renders of the title screen at chosen moments of its sequence and at
 * desktop and phone sizes, into `preview/title/`.
 *
 * Drawn through the real `TitleScene` with its clock frozen on each moment
 * (`showMoment`), so every layer and the menu paint exactly what the game
 * would on that frame, and a render is the same every time it is run.
 *
 *   npm run render:title
 *   npm run render:title -- 1440x900 ignition   (only renders whose file name holds every word)
 */

import { installBrowserShim } from './browserShim.js';
import type { Density } from '../src/ui/theme/tokens.js';
import type { SafeAreaInsets } from '../src/ui/core/viewport.js';
import type { TitleMoment } from '../src/scenes/title/titleClock.js';
import type { TitleEventId } from '../src/scenes/title/titleEvents.js';

const SHIM_SCREEN = { width: 1440, height: 900, devicePixelRatio: 1 } as const;
installBrowserShim(SHIM_SCREEN);

const { createCanvas } = await import('canvas');
const { asGameContext } = await import('./nodeGameContext.js');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { NO_INSETS } = await import('../src/ui/core/viewport.js');
const { TitleScene } = await import('../src/scenes/title/TitleScene.js');
const {
  BLACKOUT_AT_MS,
  DIVE_DURATION_MS,
  IGNITION_DURATION_MS,
  LOGO_IMPACT_AT_MS,
  SPOTLIGHT_ON_AT_MS,
  TYPEWRITER_START_AT_MS,
} = await import('../src/scenes/title/titleTimeline.js');
const { requestEnvironmentSheetsForGroups } =
  await import('../src/sprites/sheets/environmentSheets.js');
const { paintEnvironmentArtNow } = await import('../src/map/environmentArtCache.js');

// The game prewarms `core` before the title appears; its torch brand is painted, not fetched.
requestEnvironmentSheetsForGroups(['core']);
paintEnvironmentArtNow();
const { planTitleEvents, TITLE_EVENT_DURATION_MS } =
  await import('../src/scenes/title/titleEvents.js');

const OUT_DIR = `${PREVIEW_DIR}/title`;
/** The first UI frame, so the menu's entrance tween has a starting point. */
const FIRST_FRAME_MS = 16;
/** Long past the menu's entrance, so every render shows it settled. */
const SETTLE_MS = 1000;

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly density: Density;
  readonly safeArea: SafeAreaInsets;
}

/** A notched phone's insets, in CSS pixels, each way up. */
const NOTCH_LANDSCAPE: SafeAreaInsets = { t: 0, r: 47, b: 21, l: 47 };
const NOTCH_PORTRAIT: SafeAreaInsets = { t: 47, r: 0, b: 34, l: 0 };

const VIEWPORTS: readonly Viewport[] = [
  { name: '1440x900', width: 1440, height: 900, density: 'pointer', safeArea: NO_INSETS },
  { name: '1024x640', width: 1024, height: 640, density: 'pointer', safeArea: NO_INSETS },
  { name: '844x390', width: 844, height: 390, density: 'touch', safeArea: NO_INSETS },
  { name: '390x844', width: 390, height: 844, density: 'touch', safeArea: NO_INSETS },
  { name: '844x390-notch', width: 844, height: 390, density: 'touch', safeArea: NOTCH_LANDSCAPE },
  { name: '390x844-notch', width: 390, height: 844, density: 'touch', safeArea: NOTCH_PORTRAIT },
];

interface NamedMoment {
  readonly name: string;
  readonly moment: TitleMoment;
  /** Whether the menu offers Continue, as it does for a player with a save. */
  readonly withSave: boolean;
  /** Renders as a player who asked the system for less motion sees it. */
  readonly reducedMotion?: boolean;
  /** How long the menu has been up, when its entrance is what the render is for; settled otherwise. */
  readonly menuUpMs?: number;
}

const DORMANT_HOLD_MS = 1500;
const FIRST_QUARTER = 0.25;
const HALFWAY = 0.5;
const THIRD_QUARTER = 0.75;
const IGNITION_QUARTERS = [FIRST_QUARTER, HALFWAY, THIRD_QUARTER] as const;
const PERCENT = 100;
/** Idle-loop times spread so the drift and any timed events land somewhere different in each. */
const EARLY_ALIVE_MS = 2000;
const MID_ALIVE_MS = 9000;
const LATE_ALIVE_MS = 21000;
const ALIVE_TIMES_MS = [EARLY_ALIVE_MS, MID_ALIVE_MS, LATE_ALIVE_MS] as const;
/** Partway into the dive, where a light that flared instead of dying would show. */
const DIVE_CATCH_SHARE = 0.3;
const DIVE_CATCH_MS = DIVE_DURATION_MS * DIVE_CATCH_SHARE;
/** Just after the blackout, where the picture should be nearly gone. */
const AFTER_BLACKOUT_MS = 120;
/** Just after a beat lands, where its flash and its shake are strongest. */
const JUST_AFTER_BEAT_MS = 60;
/** Partway through the welcome line's typing. */
const MID_TYPING_MS = 500;
/** Partway through the menu's staggered entrance. */
const MID_ENTRANCE_MS = 120;
/** Early in the idle loop, as the fast path lands a returning player on it. */
const FAST_PATH_ALIVE_MS = 250;

/** Fixes the idle beats, so the same beat lands in the same render every run. */
const RENDER_EVENT_SEED = 1;
/** How far ahead to look for each beat's first showing. */
const EVENT_PLAN_HORIZON_MS = 600000;
/** How far into each beat its render is caught, as a share of its length: its most telling instant. */
const EVENT_CATCH_SHARE: Readonly<Partial<Record<TitleEventId, number>>> = {
  systemQuip: 0.6,
  goblinPeek: 0.5,
  lootGlint: 0.5,
  mongoDash: 0.42,
};

const plannedEvents = planTitleEvents(RENDER_EVENT_SEED, EVENT_PLAN_HORIZON_MS);

function ignitionAt(name: string, stateElapsedMs: number, reducedMotion = false): NamedMoment {
  return {
    name,
    moment: { state: 'ignition', stateElapsedMs, elapsedMs: DORMANT_HOLD_MS + stateElapsedMs },
    withSave: true,
    reducedMotion,
  };
}

function aliveAt(name: string, stateElapsedMs: number, reducedMotion = false): NamedMoment {
  return {
    name,
    moment: {
      state: 'alive',
      stateElapsedMs,
      elapsedMs: DORMANT_HOLD_MS + IGNITION_DURATION_MS + stateElapsedMs,
    },
    withSave: true,
    reducedMotion,
  };
}

function eventMoments(): NamedMoment[] {
  const moments: NamedMoment[] = [];
  for (const [id, share] of Object.entries(EVENT_CATCH_SHARE)) {
    const first = plannedEvents.find((planned) => planned.id === id);
    if (first === undefined) continue;
    const timeMs = Math.round(first.atAliveMs + TITLE_EVENT_DURATION_MS[first.id] * share);
    moments.push({
      name: `event-${id}`,
      moment: {
        state: 'alive',
        stateElapsedMs: timeMs,
        elapsedMs: DORMANT_HOLD_MS + IGNITION_DURATION_MS + timeMs,
      },
      withSave: true,
    });
  }
  return moments;
}

const MOMENTS: readonly NamedMoment[] = [
  {
    name: 'dormant',
    moment: { state: 'dormant', stateElapsedMs: DORMANT_HOLD_MS },
    withSave: true,
  },
  {
    name: 'dormant-no-save',
    moment: { state: 'dormant', stateElapsedMs: DORMANT_HOLD_MS },
    withSave: false,
  },
  ...IGNITION_QUARTERS.map((quarter) => ({
    name: `ignition-${Math.round(quarter * PERCENT)}`,
    moment: {
      state: 'ignition' as const,
      stateElapsedMs: IGNITION_DURATION_MS * quarter,
      elapsedMs: DORMANT_HOLD_MS + IGNITION_DURATION_MS * quarter,
    },
    withSave: true,
  })),
  ...ALIVE_TIMES_MS.map((timeMs) => ({
    name: `alive-${timeMs}ms`,
    moment: {
      state: 'alive' as const,
      stateElapsedMs: timeMs,
      elapsedMs: DORMANT_HOLD_MS + IGNITION_DURATION_MS + timeMs,
    },
    withSave: true,
  })),
  ignitionAt('ignition-spotlight', SPOTLIGHT_ON_AT_MS + JUST_AFTER_BEAT_MS),
  ignitionAt('ignition-impact', LOGO_IMPACT_AT_MS + JUST_AFTER_BEAT_MS),
  ignitionAt('ignition-typing', TYPEWRITER_START_AT_MS + MID_TYPING_MS),
  ignitionAt('ignition-impact-reduced', LOGO_IMPACT_AT_MS + JUST_AFTER_BEAT_MS, true),
  aliveAt('alive-9000ms-reduced', MID_ALIVE_MS, true),
  {
    name: 'fast-path-entrance',
    moment: { state: 'alive', stateElapsedMs: FAST_PATH_ALIVE_MS },
    withSave: true,
    menuUpMs: MID_ENTRANCE_MS,
  },
  {
    name: 'dive-from-dormant',
    moment: {
      state: 'dive',
      stateElapsedMs: DIVE_CATCH_MS,
      elapsedMs: DORMANT_HOLD_MS + DIVE_CATCH_MS,
      diveFrom: 'dormant',
    },
    withSave: true,
  },
  {
    name: 'dive-from-alive',
    moment: {
      state: 'dive',
      stateElapsedMs: DIVE_CATCH_MS,
      elapsedMs: DORMANT_HOLD_MS + IGNITION_DURATION_MS + MID_ALIVE_MS + DIVE_CATCH_MS,
      diveFrom: 'alive',
    },
    withSave: true,
  },
  {
    name: 'dive-blackout',
    moment: {
      state: 'dive',
      stateElapsedMs: BLACKOUT_AT_MS + AFTER_BLACKOUT_MS,
      elapsedMs:
        DORMANT_HOLD_MS + IGNITION_DURATION_MS + MID_ALIVE_MS + BLACKOUT_AT_MS + AFTER_BLACKOUT_MS,
      diveFrom: 'alive',
    },
    withSave: true,
  },
  ...eventMoments(),
];

const nameFilters = process.argv.slice(2);

const sceneManager = new SceneManager();
const input = new InputManager();
const noContinue = undefined;
const fakeContinue = (): void => undefined;

for (const viewport of VIEWPORTS) {
  for (const { name, moment, withSave, reducedMotion, menuUpMs } of MOMENTS) {
    const fileName = `${viewport.name}-${name}`;
    if (!nameFilters.every((filter) => fileName.includes(filter))) continue;
    let uiClockMs = FIRST_FRAME_MS;
    const scene = new TitleScene(input, sceneManager, {}, withSave ? fakeContinue : noContinue, {
      // Held dormant so nothing fires before the frozen moment delivers its own cues.
      startState: 'dormant',
      viewport: () => ({
        cssWidth: viewport.width,
        cssHeight: viewport.height,
        density: viewport.density,
        uiSize: 'medium',
        safeArea: viewport.safeArea,
      }),
      now: () => uiClockMs,
      reducedMotion: reducedMotion ?? false,
      eventSeed: RENDER_EVENT_SEED,
    });
    scene.onEnter();
    scene.showMoment(moment);
    scene.update();

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = asGameContext(canvas.getContext('2d'));
    scene.render(ctx);
    uiClockMs += menuUpMs ?? SETTLE_MS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    scene.render(ctx);
    scene.onExit();
    scene.ui.dispose();

    const out = writePreviewPng(`${OUT_DIR}/${fileName}.png`, canvas.toBuffer('image/png'));
    console.log(`wrote ${out}`);
  }
}
