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
 *  1. The real inventory screen, both tabs, and the real HUD hotbar, drawn
 *     through a `UiRoot` (the hotbar into the slots `hudLayout` gives it), with every item
 *     placed in their slots in turn, at desktop, tablet and phone viewports,
 *     at both input densities, and at the degenerate viewports a browser
 *     reports while a window is minimised or being created (0 or a few pixels
 *     across). The slot sizes come from the layouts themselves, so a layout
 *     change that shrinks a slot is covered for free.
 *  2. `drawItemIcon` directly at every whole size from 1 px to the largest any
 *     surface draws (loot popups, reward cards, the shop and pause tabs all
 *     sit inside this range), plus 0, negative and non-finite sizes, which
 *     must draw nothing rather than throw.
 *
 * It also checks the hotbar keeps drawing after an icon painter throws: a
 * painter that throws inside the hotbar must cost that one icon, not the rest
 * of the hotbar, and must leave the save stack where it found it.
 *
 *   npm run verify:item-icons
 */

import type { InventoryItem, ItemId } from '../src/core/ItemDefs.js';
import type { Surface } from '../src/ui/core/UiRoot.js';
import type { HotbarInput, HotbarSlotModel } from '../src/ui/hud/hudModel.js';
import type { InventoryOwner, InventoryTab } from '../src/ui/screens/inventory/inventoryTypes.js';
import type { Density } from '../src/ui/theme/tokens.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';
import { watchCanvas } from './strictCanvas.js';

installCanvasGlobals();

const { drawItemIcon } = await import('../src/ui/icons/drawItemIcon.js');
const { InventoryScreen } = await import('../src/ui/screens/inventory/InventoryScreen.js');
const { InventoryActions } = await import('../src/ui/screens/inventory/InventoryActions.js');
const { ITEM_DEF, HOTBAR_COUNT, isItemId } = await import('../src/core/ItemDefs.js');
const { Inventory } = await import('../src/core/Inventory.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { UiRoot } = await import('../src/ui/core/UiRoot.js');
const { NO_INSETS } = await import('../src/ui/core/viewport.js');
const { hotbar } = await import('../src/ui/hud/hotbar.js');
const { hudLayout } = await import('../src/ui/hud/hudLayout.js');
const { ITEM_ICONS } = await import('../src/ui/icons/itemIcons.js');

/** Width, height in CSS px — desktop, small laptop, phones both ways, and degenerate windows. */
const VIEWPORTS: ReadonlyArray<{ readonly w: number; readonly h: number }> = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 720 },
  { w: 800, h: 600 },
  { w: 844, h: 390 },
  { w: 667, h: 375 },
  { w: 390, h: 844 },
  { w: 360, h: 640 },
  { w: 320, h: 568 },
  { w: 120, h: 120 },
  { w: 40, h: 40 },
  { w: 1, h: 1 },
];
/** Largest icon any surface draws, with headroom. */
const MAX_DIRECT_SIZE = 128;
/** A size well below zero, past any rounding a painter might do. */
const FAR_NEGATIVE_SIZE = -9;
const DEGENERATE_SIZES = [0, -1, FAR_NEGATIVE_SIZE, Number.NaN, Number.POSITIVE_INFINITY];
const ICON_ORIGIN = 8;
/** A context big enough for the largest viewport; drawing off its edge is harmless. */
const CONTEXT_SIZE = 256;
const QUANTITY = 7;
const OWNER_STAT = 5;
const SCREEN_TABS: readonly InventoryTab[] = ['bag', 'character'];
const DENSITIES: readonly Density[] = ['pointer', 'touch'];
/** The item whose painter is made to throw, in the first hotbar slot. */
const THROWING_ITEM: ItemId = 'health_potion';
/** The item in the slot after it, whose icon must still be painted. */
const NEXT_ITEM: ItemId = 'speed_fizz';

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

const IGNORE_HOTBAR_INPUT: HotbarInput = {
  press: () => undefined,
  release: () => undefined,
};

function hotbarSlotModel(item: InventoryItem | null): HotbarSlotModel {
  return {
    item,
    equipped: false,
    cooldown: 0,
    cooldownLabel: '',
    unseen: false,
  };
}

interface HotbarRig {
  /** The items the hotbar draws next frame, one per slot. */
  items: readonly (InventoryItem | null)[];
  /** What the hotbar threw on the last frame, if anything. */
  thrown: string | null;
  frame(ctx: CanvasRenderingContext2D): void;
}

/**
 * A `UiRoot` whose one surface draws the HUD's hotbar into the slots
 * `hudLayout` puts on a screen of `width` × `height` CSS pixels. A throw is
 * recorded on its way out of the surface, so the gate sees it, and then left
 * to the root's own isolation, so the canvas is unwound as in the game.
 */
function hotbarRig(width: number, height: number, density: Density): HotbarRig {
  const rig: HotbarRig = {
    items: [],
    thrown: null,
    frame: (ctx) => {
      rig.thrown = null;
      root.frame(ctx);
    },
  };
  const surface: Surface = {
    id: 'hotbar',
    band: 'hud',
    haltsWorld: false,
    isOpen: () => true,
    render: (ui) => {
      const geometry = hudLayout({
        viewport: ui.viewport,
        size: ui.size,
        density: ui.density,
        miniMapExpanded: false,
        build: false,
      });
      const slots = Array.from({ length: HOTBAR_COUNT }, (_, index) =>
        hotbarSlotModel(rig.items[index] ?? null),
      );
      try {
        hotbar(ui, geometry.hotbar, { slots, input: IGNORE_HOTBAR_INPUT });
      } catch (error) {
        rig.thrown = error instanceof Error ? error.message : 'a non-Error value';
        throw error;
      }
    },
  };
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: width,
      cssHeight: height,
      density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => 0,
    warn: () => undefined,
  });
  root.mount(surface);
  return rig;
}

interface ScreenRig {
  /** The pack the screen shows; refilled for every batch of items. */
  readonly owner: InventoryOwner;
  /** What the screen threw on the last frame, if anything. */
  thrown: string | null;
  showTab(tab: InventoryTab): void;
  frame(ctx: CanvasRenderingContext2D): void;
}

/**
 * A `UiRoot` showing the real inventory screen on a screen of `width` ×
 * `height` CSS pixels. A throw is recorded on its way out, as the hotbar rig
 * does.
 */
function screenRig(width: number, height: number, density: Density): ScreenRig {
  const owner: InventoryOwner = {
    inventory: new Inventory(),
    strength: OWNER_STAT,
    intelligence: OWNER_STAT,
    constitution: OWNER_STAT,
    dexterity: OWNER_STAT,
    onEquipmentChanged: () => undefined,
  };
  const screen = new InventoryScreen({
    actions: new InventoryActions(),
    party: () => [{ id: 'human', name: 'Carl', owner }],
    coins: () => 0,
  });
  screen.open({ tab: 'bag' });
  const rig: ScreenRig = {
    owner,
    thrown: null,
    showTab: (tab) => screen.setTab(tab),
    frame: (ctx) => {
      rig.thrown = null;
      root.frame(ctx);
    },
  };
  const surface: Surface = {
    ...screen.surface,
    render: (ui) => {
      try {
        screen.surface.render(ui);
      } catch (error) {
        rig.thrown = error instanceof Error ? error.message : 'a non-Error value';
        throw error;
      }
    },
  };
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: width,
      cssHeight: height,
      density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => 0,
    warn: () => undefined,
  });
  root.mount(surface);
  return rig;
}

// ── 1. The real inventory screen and hotbar, at every viewport ──────────────

const panelCtx = gameContext(CONTEXT_SIZE, CONTEXT_SIZE);
const panelWatch = watchCanvas(panelCtx);
let panelRenders = 0;
let hotbarRenders = 0;

for (const { w: width, h: height } of VIEWPORTS) {
  setViewportSize(width, height);
  for (const density of DENSITIES) {
    const rig = screenRig(width, height, density);
    for (const tab of SCREEN_TABS) {
      rig.showTab(tab);
      for (let first = 0; first < itemIds.length; first += HOTBAR_COUNT) {
        const { inventory } = rig.owner;
        inventory.bag.slots.fill(null);
        inventory.actionBar.slots.fill(null);
        const batch = itemIds.slice(first, first + HOTBAR_COUNT);
        batch.forEach((id, slot) => {
          inventory.actionBar.slots[slot] = itemFor(id);
          inventory.bag.slots[slot] = itemFor(id);
        });
        panelWatch.clear();
        const depthBefore = panelWatch.saveDepth();
        const where = `${width}x${height} ${density} ${tab} [${batch.join(', ')}]`;
        rig.frame(panelCtx);
        if (rig.thrown === null) panelRenders++;
        else
          fail(
            `panel-throw-${width}x${height}-${density}`,
            `screen at ${where} threw: ${rig.thrown}`,
          );
        for (const violation of panelWatch.violations) {
          fail(`panel-${width}x${height}-${violation}`, `screen at ${where}: ${violation}`);
        }
        if (panelWatch.saveDepth() !== depthBefore) {
          fail(
            `panel-depth-${width}x${height}`,
            `screen at ${where} left the save stack ${panelWatch.saveDepth() - depthBefore} deep`,
          );
          while (panelWatch.saveDepth() > depthBefore) panelCtx.restore();
        }
      }
    }
  }
  for (const density of DENSITIES) {
    const rig = hotbarRig(width, height, density);
    for (let first = 0; first < itemIds.length; first += HOTBAR_COUNT) {
      const batch = itemIds.slice(first, first + HOTBAR_COUNT);
      rig.items = batch.map(itemFor);
      panelWatch.clear();
      const depthBefore = panelWatch.saveDepth();
      const where = `${width}x${height} ${density} [${batch.join(', ')}]`;
      rig.frame(panelCtx);
      if (rig.thrown === null) hotbarRenders++;
      else
        fail(
          `hotbar-throw-${width}x${height}-${density}`,
          `hotbar at ${where} threw: ${rig.thrown}`,
        );
      for (const violation of panelWatch.violations) {
        fail(
          `hotbar-${width}x${height}-${density}-${violation}`,
          `hotbar at ${where}: ${violation}`,
        );
      }
      if (panelWatch.saveDepth() !== depthBefore) {
        fail(
          `hotbar-depth-${width}x${height}-${density}`,
          `hotbar at ${where} left the save stack ${panelWatch.saveDepth() - depthBefore} deep`,
        );
        while (panelWatch.saveDepth() > depthBefore) panelCtx.restore();
      }
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
      drawItemIcon(iconCtx, { x: ICON_ORIGIN, y: ICON_ORIGIN, w: size, h: size }, itemFor(id));
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

// ── 3. A painter that throws costs one icon, not the hotbar ─────────────────

const throwingCtx = gameContext(CONTEXT_SIZE, CONTEXT_SIZE);
const throwingWatch = watchCanvas(throwingCtx);
const throwingViewport = VIEWPORTS[1];
const throwingRig = hotbarRig(throwingViewport.w, throwingViewport.h, 'pointer');
throwingRig.items = [itemFor(THROWING_ITEM), itemFor(NEXT_ITEM)];
const throwingPainter = ITEM_ICONS[THROWING_ITEM];
const nextPainter = ITEM_ICONS[NEXT_ITEM];
// Counted where it is thrown: a hotbar that stopped painting icons, or a
// strict context that stopped throwing on a negative radius, would otherwise
// leave this section passing without ever having thrown anything.
let injectedThrows = 0;
let nextIconPaints = 0;
// A radius that goes negative inside the icon, from two saves deep: the strict
// context throws on it exactly as Chrome does.
ITEM_ICONS[THROWING_ITEM] = (ctx, rect) => {
  ctx.save();
  ctx.save();
  try {
    ctx.arc(rect.x, rect.y, -Math.max(1, rect.w), 0, Math.PI);
  } catch (error) {
    injectedThrows++;
    throw error;
  }
};
ITEM_ICONS[NEXT_ITEM] = (ctx, rect) => {
  nextIconPaints++;
  nextPainter(ctx, rect);
};
const quietConsole = console.error;
console.error = () => undefined;
try {
  throwingRig.frame(throwingCtx);
} finally {
  console.error = quietConsole;
  ITEM_ICONS[THROWING_ITEM] = throwingPainter;
  ITEM_ICONS[NEXT_ITEM] = nextPainter;
}
if (injectedThrows < 1) {
  fail('throwing-injected', 'the injected icon painter never threw, so nothing here was tested');
}
if (throwingRig.thrown !== null) {
  fail(
    'throwing-painter',
    `a throwing icon painter took the rest of the hotbar with it: ${throwingRig.thrown}`,
  );
}
if (nextIconPaints < 1) {
  fail('throwing-next', `the icon in the slot after a throwing painter was never painted`);
}
if (throwingWatch.saveDepth() !== 0) {
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
  `PASS verify:item-icons — ${itemIds.length} items, ${panelRenders} bag and ` +
    `${hotbarRenders} hotbar renders over ${VIEWPORTS.length} viewports, ` +
    `${iconDraws} direct draws at ${sizes.length} sizes`,
);
