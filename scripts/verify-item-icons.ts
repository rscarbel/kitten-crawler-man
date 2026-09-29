#!/usr/bin/env tsx
/**
 * Every item's icon draws at every size the game can ask for, without
 * throwing, without geometry a browser would reject or skip, and without
 * leaving anything on the canvas save stack.
 *
 * Two passes, both on a strict context (`strictCanvas.ts`) that throws on a
 * negative radius the way Chrome does — node-canvas draws it — and records any
 * `NaN` or infinite coordinate:
 *
 *  1. The real `InventoryPanel`, hotbar and open bag, with every item placed in
 *     its slots in turn, at desktop, tablet and phone viewports and at the
 *     degenerate ones a browser reports while a window is minimised or being
 *     created (0 or a few pixels across). The slot sizes come from the panel's
 *     own layout, so a layout change that shrinks a slot is covered for free.
 *  2. `drawItemIcon` directly at every whole size from 1 px to the largest any
 *     surface draws (loot popups, reward cards, the shop and pause tabs all
 *     sit inside this range), plus 0, negative and non-finite sizes, which
 *     must draw nothing rather than throw.
 *
 * It also checks the panel keeps drawing after an icon painter throws: a
 * painter that throws inside the hotbar must cost that one icon, not the rest
 * of the frame, and must leave the save stack where it found it.
 *
 *   npm run verify:item-icons
 */

import type { InventoryItem, ItemId } from '../src/core/ItemDefs.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';
import { watchCanvas } from './strictCanvas.js';

installCanvasGlobals();

const { drawItemIcon, hotbarStripRect, InventoryPanel } =
  await import('../src/ui/InventoryPanel.js');
const { ITEM_DEF, HOTBAR_COUNT, isItemId } = await import('../src/core/ItemDefs.js');
const { Inventory } = await import('../src/core/Inventory.js');
const { setViewportSize } = await import('../src/core/Viewport.js');

/** Width, height in CSS px — desktop, small laptop, phones both ways, and degenerate windows. */
const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080],
  [1280, 720],
  [800, 600],
  [844, 390],
  [667, 375],
  [390, 844],
  [360, 640],
  [320, 568],
  [120, 120],
  [40, 40],
  [1, 1],
];
/** Largest icon any surface draws, with headroom. */
const MAX_DIRECT_SIZE = 128;
const DEGENERATE_SIZES = [0, -1, -9, Number.NaN, Number.POSITIVE_INFINITY];
const ICON_ORIGIN = 8;
/** A context big enough for the largest viewport; drawing off its edge is harmless. */
const CONTEXT_SIZE = 256;
const QUANTITY = 7;

const failures: string[] = [];
/** One report per item, surface and problem, so a broken painter does not print a thousand lines. */
const reported = new Set<string>();
function fail(key: string, message: string): void {
  if (reported.has(key)) return;
  reported.add(key);
  failures.push(message);
}

const itemIds: ItemId[] = Object.keys(ITEM_DEF).filter(isItemId);

function itemFor(id: ItemId): InventoryItem {
  return { ...ITEM_DEF[id], quantity: QUANTITY };
}

// ── 1. The real panel, at every viewport ────────────────────────────────────

const panelCtx = gameContext(CONTEXT_SIZE, CONTEXT_SIZE);
const panelWatch = watchCanvas(panelCtx);
const panel = new InventoryPanel();
panel.isOpen = true;
let panelRenders = 0;

for (const [width, height] of VIEWPORTS) {
  setViewportSize(width, height);
  for (let first = 0; first < itemIds.length; first += HOTBAR_COUNT) {
    const inventory = new Inventory();
    const batch = itemIds.slice(first, first + HOTBAR_COUNT);
    batch.forEach((id, slot) => {
      inventory.actionBar.slots[slot] = itemFor(id);
      inventory.bag.slots[slot] = itemFor(id);
    });
    panelWatch.clear();
    const depthBefore = panelWatch.saveDepth();
    const where = `${width}x${height} [${batch.join(', ')}]`;
    try {
      panel.render(panelCtx, inventory, 'Human', 0);
      panelRenders++;
    } catch (error) {
      fail(`panel-throw-${width}x${height}`, `panel at ${where} threw: ${String(error)}`);
    }
    for (const violation of panelWatch.violations) {
      fail(`panel-${width}x${height}-${violation}`, `panel at ${where}: ${violation}`);
    }
    if (panelWatch.saveDepth() !== depthBefore) {
      fail(
        `panel-depth-${width}x${height}`,
        `panel at ${where} left the save stack ${panelWatch.saveDepth() - depthBefore} deep`,
      );
      while (panelWatch.saveDepth() > depthBefore) panelCtx.restore();
    }
  }
}

// ── 2. drawItemIcon at every size ───────────────────────────────────────────

const iconCtx = gameContext(CONTEXT_SIZE, CONTEXT_SIZE);
const iconWatch = watchCanvas(iconCtx);
const sizes = [
  ...Array.from({ length: MAX_DIRECT_SIZE }, (_, index) => index + 1),
  ...DEGENERATE_SIZES,
];
let iconDraws = 0;

for (const id of itemIds) {
  for (const size of sizes) {
    iconWatch.clear();
    try {
      drawItemIcon(iconCtx, itemFor(id), ICON_ORIGIN, ICON_ORIGIN, size);
      iconDraws++;
    } catch (error) {
      fail(`icon-throw-${id}`, `${id} at ${size} px threw: ${String(error)}`);
    }
    for (const violation of iconWatch.violations) {
      fail(`icon-${id}-${violation.split(':')[0]}`, `${id} at ${size} px: ${violation}`);
    }
    if (iconWatch.saveDepth() !== 0) {
      fail(
        `icon-depth-${id}`,
        `${id} at ${size} px left the save stack ${iconWatch.saveDepth()} deep`,
      );
      while (iconWatch.saveDepth() > 0) iconCtx.restore();
    }
  }
}

// ── 3. A painter that throws costs one icon, not the frame ──────────────────

const throwingCtx = gameContext(CONTEXT_SIZE, CONTEXT_SIZE);
const throwingWatch = watchCanvas(throwingCtx);
setViewportSize(VIEWPORTS[1][0], VIEWPORTS[1][1]);
// A radius that goes negative inside an icon on the hotbar, from two saves
// deep: the strict context throws on it exactly as Chrome does. Arcs outside
// the hotbar strip — the bag toggle's own art — draw normally.
const strip = hotbarStripRect();
const originalArc = throwingCtx.arc.bind(throwingCtx);
// Counted where it is thrown: a hotbar that stopped drawing arcs, or a strict
// context that stopped throwing on a negative radius, would otherwise leave
// this section passing without ever having thrown anything.
let injectedThrows = 0;
throwingCtx.arc = (x, y, radius, start, end, counterclockwise) => {
  const onHotbar = x >= strip.x && x <= strip.x + strip.w && y >= strip.y && y <= strip.y + strip.h;
  if (!onHotbar) {
    originalArc(x, y, radius, start, end, counterclockwise);
    return;
  }
  throwingCtx.save();
  throwingCtx.save();
  try {
    originalArc(x, y, -Math.abs(radius) - 1, start, end, counterclockwise);
  } catch (error) {
    injectedThrows++;
    throw error;
  }
};
const throwingInventory = new Inventory();
throwingInventory.actionBar.slots[0] = itemFor('health_potion');
const quietConsole = console.error;
console.error = () => undefined;
let panelSurvived = false;
try {
  panel.render(throwingCtx, throwingInventory, 'Human', 0);
  panelSurvived = true;
} catch (error) {
  fail(
    'throwing-painter',
    `a throwing icon painter took the whole panel with it: ${String(error)}`,
  );
} finally {
  console.error = quietConsole;
}
if (injectedThrows < 1) {
  fail('throwing-injected', 'the injected icon painter never threw, so nothing here was tested');
}
if (panelSurvived && throwingWatch.saveDepth() !== 0) {
  fail(
    'throwing-depth',
    `a throwing icon painter left the save stack ${throwingWatch.saveDepth()} deep`,
  );
}

if (failures.length > 0) {
  console.error(`FAIL verify:item-icons — ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `PASS verify:item-icons — ${itemIds.length} items, ${panelRenders} panel renders over ` +
    `${VIEWPORTS.length} viewports, ${iconDraws} direct draws at ${sizes.length} sizes`,
);
