#!/usr/bin/env tsx
/**
 * Review harness for the Meat Shields hire desk: renders the desk screen
 * through a real `UiRoot` at the smallest viewport it has to fit and at a
 * desktop one, in each of the states a player can put it in, and checks the
 * desk's rules through taps and keys on what is drawn.
 *
 *   npm run render:merc-desk
 *
 * Checks, each of which fails the run:
 *  - every list row and the pane's Hire or Dismiss is drawn on screen;
 *  - a press on a row never spends coins, however often it lands;
 *  - a second tap on Hire never hires twice or charges twice;
 *  - mashing Enter never spends more than one hire's coins;
 *  - Dismiss asks first: a bare Enter keeps the contract, Yes tears it up;
 *  - Rosemarie's condolences clear the roster's `lastDeceased`, so she says them once.
 *
 * Output lands in `preview/merc-desk/`.
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { createMercenaryRoster, type MercenaryRoster } from '../src/core/MercenaryRoster.js';
import { MERCENARY_TEMPLATES } from '../src/core/mercenaryTemplates.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { MercenaryGuildSystem } from '../src/systems/MercenaryGuildSystem.js';
import { UiRoot, type HitRegion } from '../src/ui/core/UiRoot.js';
import { MOUSE_POINTER_ID, PRIMARY_BUTTON } from '../src/ui/core/pointer.js';
import { NO_INSETS } from '../src/ui/core/viewport.js';
import { mercenaryDeskSurface } from '../src/ui/screens/shop/MercenaryDeskScreen.js';
import type { Density } from '../src/ui/theme/tokens.js';

installCanvasGlobals();

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly density: Density;
}

/** A landscape phone is the shortest screen the game is played on. */
const SMALLEST: Viewport = { name: 'phone-568x320', width: 568, height: 320, density: 'touch' };
const DESKTOP: Viewport = {
  name: 'desktop-1280x720',
  width: 1280,
  height: 720,
  density: 'pointer',
};
const VIEWPORTS: readonly Viewport[] = [SMALLEST, DESKTOP];

const DESK_SURFACE_ID = 'club-guild';
const CONFIRM_SURFACE_ID = 'club-guild-dismiss';
/** The confirm dialog's own panel id, under which its answers register. */
const CONFIRM_PANEL_ID = 'confirm';
const FLOOR_ID = 'harness_floor';
const RICH_PURSE = 400;
const POOR_PURSE = 150;
const BACKDROP = '#1a1420';
/** Frames the desk clock runs before a shot, so portraits are mid-idle rather than on frame zero. */
const WARM_FRAMES = 40;
const FRAME_MS = 16;
/** Long enough for every open tween to settle. */
const SETTLE_MS = 1000;
const DECEASED_NAME = 'Gluteus Maxx';
/** The list's last row is Damascus, after every hire. */
const DAMASCUS_ROW = MERCENARY_TEMPLATES.length;
const BUCKET_BOY_PRICE = MERCENARY_TEMPLATES.find((t) => t.id === 'bucket_boy')?.price ?? 0;
const MASHED_ENTERS = 5;
/** Wheel steps tried before a row counts as never drawn. */
const MAX_SCROLL_STEPS = 8;
/** One wheel notch, in UI units. */
const SCROLL_STEP = 100;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

interface Desk {
  readonly guild: MercenaryGuildSystem;
  readonly roster: MercenaryRoster;
  readonly human: HumanPlayer;
  readonly viewport: Viewport;
  readonly root: UiRoot;
  readonly canvas: ReturnType<typeof createCanvas>;
  settle(): void;
}

function openDesk(
  viewport: Viewport,
  coins: number,
  setup?: (roster: MercenaryRoster) => void,
): Desk {
  const roster = createMercenaryRoster();
  roster.floorLevelId = FLOOR_ID;
  setup?.(roster);
  const guild = new MercenaryGuildSystem(roster, null);
  for (let i = 0; i < WARM_FRAMES; i++) guild.updateDesk();
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  human.coins = coins;
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  cat.coins = 0;
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      density: viewport.density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => clock,
    warn: () => undefined,
  });
  root.mount(
    mercenaryDeskSurface({
      id: DESK_SURFACE_ID,
      desk: guild,
      party: () => ({ active: human, companion: cat }),
    }),
  );
  root.mount(guild.dismissConfirm.surface(CONFIRM_SURFACE_ID));
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = asGameContext(canvas.getContext('2d'));
  const frame = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    root.frame(ctx);
  };
  const desk: Desk = {
    guild,
    roster,
    human,
    viewport,
    root,
    canvas,
    settle: () => {
      clock += SETTLE_MS;
      frame();
      clock += FRAME_MS;
      frame();
    },
  };
  guild.openPanel();
  desk.settle();
  return desk;
}

function region(desk: Desk, id: string): HitRegion | null {
  return desk.root.regions().find((candidate) => candidate.id === id) ?? null;
}

function deskRegionId(widgetId: string): string {
  return `${DESK_SURFACE_ID}/${DESK_SURFACE_ID}/${widgetId}`;
}

function confirmRegionId(answer: 'yes' | 'no'): string {
  return `${CONFIRM_SURFACE_ID}/${CONFIRM_PANEL_ID}/${answer}`;
}

function gesture(
  desk: Desk,
  kind: 'down' | 'up' | 'wheel',
  point: { readonly x: number; readonly y: number },
  deltaY = 0,
): void {
  const scale = desk.root.uiScale;
  desk.root.pointer({
    kind,
    pointerId: MOUSE_POINTER_ID,
    source: desk.viewport.density === 'touch' ? 'touch' : 'mouse',
    x: point.x,
    y: point.y,
    cssX: point.x * scale,
    cssY: point.y * scale,
    button: PRIMARY_BUTTON,
    deltaY,
  });
}

function centre(target: HitRegion): { x: number; y: number } {
  return { x: target.rect.x + target.rect.w / 2, y: target.rect.y + target.rect.h / 2 };
}

/** Scrolls the desk's body until region `id` is drawn, as a player would to reach a row below the fold. */
function reveal(desk: Desk, id: string): HitRegion | null {
  for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
    const found = region(desk, id);
    if (found !== null) return found;
    const scroller = desk.root
      .regions()
      .find(
        (candidate) => candidate.surfaceId === DESK_SURFACE_ID && candidate.onWheel !== undefined,
      );
    if (scroller === undefined) return null;
    gesture(desk, 'wheel', centre(scroller), SCROLL_STEP);
    desk.settle();
  }
  return region(desk, id);
}

/** Taps the centre of region `id`, scrolling it into view first; null when it is nowhere to be drawn. */
function tapIfDrawn(desk: Desk, id: string): boolean {
  const target = reveal(desk, id);
  if (target === null) return false;
  gesture(desk, 'down', centre(target));
  gesture(desk, 'up', centre(target));
  desk.settle();
  return true;
}

/** Taps region `id`; records a failure when it is not drawn. */
function tap(desk: Desk, id: string): void {
  if (!tapIfDrawn(desk, id)) failures.push(`${desk.viewport.name}: no region "${id}" to tap`);
}

function key(desk: Desk, pressed: string): void {
  desk.root.key(pressed, {});
  desk.settle();
}

function save(desk: Desk, state: string): void {
  desk.settle();
  const path = writePreviewPng(
    `${PREVIEW_DIR}/merc-desk/${desk.viewport.name}-${state}.png`,
    desk.canvas.toBuffer('image/png'),
  );
  console.log(`  wrote ${path}`);
}

function hireSledge(roster: MercenaryRoster): void {
  roster.active = { id: 'sledge', name: 'The Sledge', contractLevelId: FLOOR_ID, introduced: true };
}

function hiredId(desk: Desk): string {
  return desk.roster.active?.id ?? 'nobody';
}

/** Every region `id` is drawn and lies on the screen. */
function checkOnScreen(desk: Desk, ids: readonly string[], state: string): void {
  const scale = desk.root.uiScale;
  for (const id of ids) {
    const found = region(desk, id);
    if (found === null) {
      failures.push(`${desk.viewport.name}/${state}: "${id}" is not drawn`);
      continue;
    }
    const right = (found.rect.x + found.rect.w) * scale;
    const bottom = (found.rect.y + found.rect.h) * scale;
    check(
      found.rect.x >= 0 &&
        found.rect.y >= 0 &&
        right <= desk.viewport.width &&
        bottom <= desk.viewport.height,
      `${desk.viewport.name}/${state}: "${id}" runs off the screen`,
    );
  }
}

const ROW_IDS = [...MERCENARY_TEMPLATES.map((_, row) => row), DAMASCUS_ROW].map((row) =>
  deskRegionId(`row-${row}`),
);

function renderStates(viewport: Viewport): void {
  console.log(viewport.name);

  const fresh = openDesk(viewport, RICH_PURSE);
  save(fresh, '1-fresh');
  checkOnScreen(fresh, [deskRegionId('hire')], 'fresh');
  if (viewport === DESKTOP) checkOnScreen(fresh, ROW_IDS, 'fresh');

  const poor = openDesk(viewport, POOR_PURSE);
  tap(poor, deskRegionId(`row-${MERCENARY_TEMPLATES.length - 1}`));
  save(poor, '2-too-dear');

  const hired = openDesk(viewport, RICH_PURSE, hireSledge);
  save(hired, '3-contract-dismiss');
  checkOnScreen(hired, [deskRegionId('dismiss')], 'contract');
  tap(hired, deskRegionId('dismiss'));
  save(hired, '3b-dismiss-confirm');
  tap(hired, confirmRegionId('no'));
  tap(hired, deskRegionId('row-0'));
  save(hired, '4-contract-blocks-hire');

  const damascus = openDesk(viewport, RICH_PURSE);
  tap(damascus, deskRegionId(`row-${DAMASCUS_ROW}`));
  tap(damascus, deskRegionId(`row-${DAMASCUS_ROW}`));
  save(damascus, '5-damascus');

  const mourning = openDesk(viewport, RICH_PURSE, (roster) => {
    roster.lastDeceased = DECEASED_NAME;
  });
  check(mourning.roster.lastDeceased === null, 'opening the desk left lastDeceased set');
  save(mourning, '6-condolences');
}

function checkRules(viewport: Viewport): void {
  const name = viewport.name;

  const rows = openDesk(viewport, RICH_PURSE);
  for (const id of ROW_IDS) {
    tap(rows, id);
    tap(rows, id);
  }
  check(
    rows.roster.active === null && rows.human.coins === RICH_PURSE,
    `${name}: pressing rows hired ${hiredId(rows)} and left ${rows.human.coins} coins`,
  );

  const doubleHire = openDesk(viewport, RICH_PURSE);
  tap(doubleHire, deskRegionId('hire'));
  tapIfDrawn(doubleHire, deskRegionId('hire'));
  check(
    hiredId(doubleHire) === 'bucket_boy' &&
      doubleHire.human.coins === RICH_PURSE - BUCKET_BOY_PRICE,
    `${name}: two taps on Hire left ${hiredId(doubleHire)} hired with ${doubleHire.human.coins} coins`,
  );

  const mashed = openDesk(viewport, RICH_PURSE);
  for (let i = 0; i < MASHED_ENTERS; i++) key(mashed, 'Enter');
  check(
    mashed.human.coins >= RICH_PURSE - BUCKET_BOY_PRICE,
    `${name}: ${MASHED_ENTERS} Enters left ${mashed.human.coins} coins`,
  );

  const dismissing = openDesk(viewport, RICH_PURSE, hireSledge);
  tap(dismissing, deskRegionId('dismiss'));
  check(dismissing.guild.dismissConfirm.isOpen, `${name}: Dismiss did not ask first`);
  key(dismissing, 'Enter');
  check(dismissing.roster.active !== null, `${name}: a bare Enter tore the contract up`);
  tap(dismissing, deskRegionId('dismiss'));
  tap(dismissing, confirmRegionId('yes'));
  check(dismissing.roster.active === null, `${name}: Yes did not tear the contract up`);
}

/** One shot per hire, so every portrait is looked at in its frame. */
function renderPortraits(viewport: Viewport): void {
  MERCENARY_TEMPLATES.forEach((template, row) => {
    const desk = openDesk(viewport, RICH_PURSE);
    tap(desk, deskRegionId(`row-${row}`));
    save(desk, `8-portrait-${template.id}`);
  });
}

for (const viewport of VIEWPORTS) {
  renderStates(viewport);
  checkRules(viewport);
}
renderPortraits(DESKTOP);

if (failures.length > 0) {
  console.error(`\nmerc desk: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nmerc desk: all checks passed');
