#!/usr/bin/env tsx
/**
 * Keyboard reach on the pause screen: from the first control of a long page,
 * Tab must walk focus down to the last control without wrapping back to the
 * menu, scrolling rows into view as it goes, and Shift+Tab and the arrows
 * must walk back up the same way. Run headless through a real `UiRoot` on a
 * desktop and a phone viewport.
 *
 * Run: npm run verify:pause-keyboard
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { UiRoot } from '../src/ui/core/UiRoot.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';
import type { Density } from '../src/ui/theme/tokens.js';
import type { PauseSectionId } from '../src/ui/screens/pause/section.js';
import { pauseFixtureData, pauseFixtureScreen } from '../src/dev/uiGallery/pause.js';

interface Case {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly density: Density;
  readonly section: PauseSectionId;
}

const CASES: readonly Case[] = [
  { name: 'controls on desktop', w: 1024, h: 640, density: 'pointer', section: 'controls' },
  { name: 'controls on a phone', w: 568, h: 320, density: 'pointer', section: 'controls' },
  { name: 'settings on a phone', w: 568, h: 320, density: 'touch', section: 'settings' },
  { name: 'journal on a phone', w: 568, h: 320, density: 'touch', section: 'journal' },
];

const FRAME_MS = 16;
/** Frames run after each key, so a scroll the key asked for lands and the ring is rebuilt. */
const FRAMES_PER_KEY = 2;
/** Far more presses than any page has controls: running out means focus is stuck. */
const MAX_PRESSES = 400;

const failures: string[] = [];

function runCase(c: Case): void {
  let clock = 0;
  const viewport = (): ViewportInput => ({
    cssWidth: c.w,
    cssHeight: c.h,
    density: c.density,
    uiSize: 'medium',
    safeArea: NO_INSETS,
  });
  const root = new UiRoot({ audio: null, viewport, now: () => clock, warn: () => undefined });
  const screen = pauseFixtureScreen(pauseFixtureData());
  root.mount(
    screen.surface({
      frame: () => pauseFixtureData().frame,
      onEscape: () => screen.close(),
      openInventory: () => undefined,
    }),
  );
  screen.open(c.section);
  const canvas = createCanvas(c.w, c.h);
  const ctx = asGameContext(canvas.getContext('2d'));
  const frame = (): void => {
    for (let i = 0; i < FRAMES_PER_KEY; i++) {
      clock += FRAME_MS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      root.frame(ctx);
    }
  };
  frame();

  const press = (key: string, shift = false): void => {
    root.key(key, { shift });
    frame();
  };
  const onPage = (): boolean => screen.keyboardFocus()?.areaId.includes(c.section) === true;

  let presses = 0;
  while (!onPage() && presses < MAX_PRESSES) {
    press('Tab');
    presses++;
  }
  const start = screen.keyboardFocus();
  if (start === null || !onPage()) {
    failures.push(`${c.name}: Tab never reached the page`);
    return;
  }
  if (start.index !== 0)
    failures.push(`${c.name}: Tab entered the page at control ${start.index}, not 0`);

  type Goal = (focus: NonNullable<ReturnType<typeof screen.keyboardFocus>>) => boolean;
  const walk = (key: string, shift: boolean, goal: Goal, label: string): void => {
    let previous = screen.keyboardFocus()?.index ?? -1;
    for (let i = 0; i < MAX_PRESSES; i++) {
      press(key, shift);
      const focus = screen.keyboardFocus();
      if (!onPage() || focus === null) {
        failures.push(`${c.name}: ${label} left the page at control ${previous}`);
        return;
      }
      if (goal(focus)) return;
      previous = focus.index;
    }
    failures.push(`${c.name}: ${label} stuck at control ${previous}`);
  };

  const last = start.count - 1;
  walk('Tab', false, (focus) => focus.index === last, 'Tab');
  walk('Tab', true, (focus) => focus.index === 0, 'Shift+Tab');
  // The arrows go by geometry, so they finish on the bottom (or top) row rather than a given control.
  walk('ArrowDown', false, (focus) => focus.top === focus.lastTop, 'ArrowDown');
  walk('ArrowUp', false, (focus) => focus.top === focus.firstTop, 'ArrowUp');
}

installCanvasGlobals();
for (const c of CASES) runCase(c);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}
console.log(`verify:pause-keyboard: ${CASES.length} pages walked end to end and back.`);
