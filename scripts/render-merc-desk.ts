#!/usr/bin/env tsx
/**
 * Review harness for the Meat Shields hire desk: renders the panel at the
 * smallest viewport it has to fit and at a desktop one, in each of the states
 * a player can put it in, and checks the keyboard ring against what is drawn.
 *
 *   npm run render:merc-desk
 *
 * Checks, each of which fails the run:
 *  - every focus-ring entry's click point lands inside the panel and the viewport;
 *  - the ring holds every list row, then the pane's controls;
 *  - down, Enter, Enter hires the row browsed to, and Up out of the pane
 *    leaves the selection where it was;
 *  - a press on a row never spends coins, keyboard-focused or not;
 *  - a second click or a second Enter on Hire never dismisses the hire;
 *  - Enter, Enter, Down, Enter tears up a contract from the keyboard;
 *  - Rosemarie's condolences clear the roster's `lastDeceased`, so she says them once.
 *
 * Output lands in `preview/merc-desk/`.
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { createMercenaryRoster, type MercenaryRoster } from '../src/core/MercenaryRoster.js';
import { MERCENARY_TEMPLATES } from '../src/core/mercenaryTemplates.js';
import { MercenaryGuildSystem } from '../src/systems/MercenaryGuildSystem.js';
import {
  clearMenuFocus,
  focusNextButton,
  focusedButtonClickPoint,
  focusPreviousButton,
  menuFocusRingSize,
  setButtonMouseState,
} from '../src/ui/Button.js';

installCanvasGlobals();

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** A landscape phone is the shortest screen the game is played on. */
const SMALLEST: Viewport = { name: 'phone-568x320', width: 568, height: 320 };
const DESKTOP: Viewport = { name: 'desktop-1280x720', width: 1280, height: 720 };
const VIEWPORTS: readonly Viewport[] = [SMALLEST, DESKTOP];

const FLOOR_ID = 'harness_floor';
const RICH_PURSE = 400;
const POOR_PURSE = 150;
const BACKDROP = '#1a1420';
/** Where the pointer rests: off the canvas, so no button shows a hover the keyboard did not cause. */
const POINTER_OFF_CANVAS = -1000;
/** Frames the desk clock runs before a shot, so portraits are mid-idle rather than on frame zero. */
const WARM_FRAMES = 40;
const DECEASED_NAME = 'Gluteus Maxx';
/** The list's last row is Damascus, after every hire. */
const DAMASCUS_ROW = MERCENARY_TEMPLATES.length;
const SPLASH_ZONE_ROW = MERCENARY_TEMPLATES.findIndex((t) => t.id === 'splash_zone');
const BUCKET_BOY_PRICE = MERCENARY_TEMPLATES.find((t) => t.id === 'bucket_boy')?.price ?? 0;
/** Enter on the row, Hire, then two more: the second pair must not undo the first. */
const MASHED_ENTERS = 5;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

interface Desk {
  readonly guild: MercenaryGuildSystem;
  readonly roster: MercenaryRoster;
  readonly purse: { coins: number };
}

function openDesk(coins: number, setup?: (roster: MercenaryRoster) => void): Desk {
  const roster = createMercenaryRoster();
  roster.floorLevelId = FLOOR_ID;
  setup?.(roster);
  const guild = new MercenaryGuildSystem(roster, null);
  for (let i = 0; i < WARM_FRAMES; i++) guild.updateDesk();
  clearMenuFocus();
  guild.openPanel();
  const desk = { guild, roster, purse: { coins } };
  // The first frame is the one that puts focus on the selected row.
  render(desk, SMALLEST);
  return desk;
}

function render(desk: Desk, viewport: Viewport): ReturnType<typeof createCanvas> {
  setViewportSize(viewport.width, viewport.height);
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = asGameContext(canvas.getContext('2d'));
  setButtonMouseState(POINTER_OFF_CANVAS, POINTER_OFF_CANVAS);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  desk.guild.renderPanel(ctx, desk.purse);
  return canvas;
}

function save(desk: Desk, viewport: Viewport, state: string): void {
  const canvas = render(desk, viewport);
  const path = writePreviewPng(
    `${PREVIEW_DIR}/merc-desk/${viewport.name}-${state}.png`,
    canvas.toBuffer('image/png'),
  );
  console.log(`  wrote ${path}`);
}

/** Moves focus `steps` entries round the ring, rendering between presses the way the game does. */
function stepFocus(desk: Desk, viewport: Viewport, steps: number): void {
  for (let i = 0; i < steps; i++) {
    render(desk, viewport);
    focusNextButton();
  }
  render(desk, viewport);
}

/**
 * Walks the whole ring and asserts every entry's click point is on the panel.
 * A ring entry off screen or clipped is a focus the player cannot see.
 */
function checkRing(desk: Desk, viewport: Viewport, state: string): void {
  render(desk, viewport);
  const size = menuFocusRingSize();
  const minimum = MERCENARY_TEMPLATES.length + 2;
  check(size >= minimum, `${viewport.name}/${state}: ring has ${size} entries, want ≥ ${minimum}`);
  for (let i = 0; i < size; i++) {
    focusNextButton();
    render(desk, viewport);
    const point = focusedButtonClickPoint();
    if (point === null) {
      failures.push(`${viewport.name}/${state}: ring entry ${i} has no click point`);
      continue;
    }
    const onScreen =
      point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height;
    check(
      onScreen,
      `${viewport.name}/${state}: ring entry ${i} at (${point.x}, ${point.y}) is off screen`,
    );
  }
  clearMenuFocus();
}

function hireSledge(roster: MercenaryRoster): void {
  roster.active = { id: 'sledge', name: 'The Sledge', contractLevelId: FLOOR_ID, introduced: true };
}

function renderStates(viewport: Viewport): void {
  console.log(viewport.name);

  const fresh = openDesk(RICH_PURSE);
  save(fresh, viewport, '1-fresh');
  checkRing(fresh, viewport, 'fresh');

  const poor = openDesk(POOR_PURSE);
  poor.guild.handleClick(...rowCentre(poor, viewport, MERCENARY_TEMPLATES.length - 1));
  save(poor, viewport, '2-too-dear');

  const hired = openDesk(RICH_PURSE, hireSledge);
  save(hired, viewport, '3-contract-dismiss');
  enter(hired, viewport);
  enter(hired, viewport);
  save(hired, viewport, '3b-dismiss-confirm');
  press(hired, viewport, 'up');
  hired.guild.handleClick(...rowCentre(hired, viewport, 0));
  save(hired, viewport, '4-contract-blocks-hire');
  checkRing(hired, viewport, 'contract');

  const damascus = openDesk(RICH_PURSE);
  damascus.guild.handleClick(...rowCentre(damascus, viewport, DAMASCUS_ROW));
  save(damascus, viewport, '5-damascus');

  const mourning = openDesk(RICH_PURSE, (roster) => {
    roster.lastDeceased = DECEASED_NAME;
  });
  check(mourning.roster.lastDeceased === null, 'opening the desk left lastDeceased set');
  save(mourning, viewport, '6-condolences');

  const keyboard = openDesk(RICH_PURSE);
  stepFocus(keyboard, viewport, SPLASH_ZONE_ROW + 1);
  save(keyboard, viewport, '7-keyboard-focus');
}

/** Where a click on list row `row` lands, in canvas space, measured off the rendered ring. */
function rowCentre(
  desk: Desk,
  viewport: Viewport,
  row: number,
): [number, number, { coins: number }] {
  clearMenuFocus();
  stepFocus(desk, viewport, row + 1);
  const point = focusedButtonClickPoint();
  clearMenuFocus();
  render(desk, viewport);
  if (point === null) {
    failures.push(`${viewport.name}: row ${row} not in the ring`);
    return [-1, -1, desk.purse];
  }
  return [point.x, point.y, desk.purse];
}

/** An Enter press: a click where the focused (or primary) button is, then the next frame. */
function enter(desk: Desk, viewport: Viewport): void {
  render(desk, viewport);
  const point = focusedButtonClickPoint();
  if (point === null) {
    failures.push(`${viewport.name}: Enter found nothing to press`);
    return;
  }
  desk.guild.handleClick(point.x, point.y, desk.purse);
  render(desk, viewport);
}

function press(desk: Desk, viewport: Viewport, key: 'up' | 'down', times = 1): void {
  for (let i = 0; i < times; i++) {
    render(desk, viewport);
    if (key === 'down') focusNextButton();
    else focusPreviousButton();
    render(desk, viewport);
  }
}

function hiredId(desk: Desk): string {
  return desk.roster.active?.id ?? 'nobody';
}

function checkKeyboard(viewport: Viewport): void {
  const name = viewport.name;
  const browse = openDesk(RICH_PURSE);
  press(browse, viewport, 'down', SPLASH_ZONE_ROW);
  enter(browse, viewport);
  enter(browse, viewport);
  check(hiredId(browse) === 'splash_zone', `${name}: Down, Enter, Enter hired ${hiredId(browse)}`);

  const upAndBack = openDesk(RICH_PURSE);
  press(upAndBack, viewport, 'down', SPLASH_ZONE_ROW);
  enter(upAndBack, viewport);
  press(upAndBack, viewport, 'up');
  // A second frame: focus coming back into the list is put on the selected row.
  render(upAndBack, viewport);
  enter(upAndBack, viewport);
  enter(upAndBack, viewport);
  check(
    hiredId(upAndBack) === 'splash_zone',
    `${name}: Up out of the pane changed the selection (hired ${hiredId(upAndBack)})`,
  );

  const focusedRow = openDesk(RICH_PURSE);
  press(focusedRow, viewport, 'down', SPLASH_ZONE_ROW);
  render(focusedRow, viewport);
  const rowPoint = focusedButtonClickPoint();
  if (rowPoint === null) failures.push(`${name}: no focused row to click`);
  else {
    // The pointer lands exactly where the keyboard would, on the row the ring is on.
    focusedRow.guild.handleClick(rowPoint.x, rowPoint.y, focusedRow.purse);
    render(focusedRow, viewport);
    focusedRow.guild.handleClick(rowPoint.x, rowPoint.y, focusedRow.purse);
    check(focusedRow.roster.active === null, `${name}: clicking a focused row hired it`);
  }

  const mashed = openDesk(RICH_PURSE);
  for (let i = 0; i < MASHED_ENTERS; i++) enter(mashed, viewport);
  check(
    hiredId(mashed) === 'bucket_boy' && mashed.purse.coins === RICH_PURSE - BUCKET_BOY_PRICE,
    `${name}: ${MASHED_ENTERS} Enters left ${hiredId(mashed)} hired with ${mashed.purse.coins} coins`,
  );

  const dismissing = openDesk(RICH_PURSE, hireSledge);
  enter(dismissing, viewport);
  enter(dismissing, viewport);
  check(dismissing.roster.active !== null, `${name}: Dismiss tore the contract up without asking`);
  press(dismissing, viewport, 'down');
  enter(dismissing, viewport);
  check(dismissing.roster.active === null, `${name}: keyboard could not tear up the contract`);
}

function checkPointerDoubleHire(viewport: Viewport): void {
  const desk = openDesk(RICH_PURSE);
  enter(desk, viewport);
  render(desk, viewport);
  const hirePoint = focusedButtonClickPoint();
  clearMenuFocus();
  render(desk, viewport);
  if (hirePoint === null) {
    failures.push(`${viewport.name}: Enter on a row did not focus Hire`);
    return;
  }
  desk.guild.handleClick(hirePoint.x, hirePoint.y, desk.purse);
  render(desk, viewport);
  desk.guild.handleClick(hirePoint.x, hirePoint.y, desk.purse);
  render(desk, viewport);
  check(
    hiredId(desk) === 'bucket_boy' && desk.purse.coins === RICH_PURSE - BUCKET_BOY_PRICE,
    `${viewport.name}: double click on Hire left ${hiredId(desk)} hired with ${desk.purse.coins} coins`,
  );
}

/** One shot per hire, so every portrait is looked at in its frame. */
function renderPortraits(viewport: Viewport): void {
  MERCENARY_TEMPLATES.forEach((template, row) => {
    const desk = openDesk(RICH_PURSE);
    desk.guild.handleClick(...rowCentre(desk, viewport, row));
    save(desk, viewport, `8-portrait-${template.id}`);
  });
}

for (const viewport of VIEWPORTS) {
  renderStates(viewport);
  checkKeyboard(viewport);
  checkPointerDoubleHire(viewport);
}
renderPortraits(DESKTOP);

if (failures.length > 0) {
  console.error(`\nmerc desk: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nmerc desk: all checks passed');
