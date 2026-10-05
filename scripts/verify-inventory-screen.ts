#!/usr/bin/env tsx
/**
 * The inventory model's tidy and full-bag report, and the inventory screen
 * driven through a real `UiRoot` the way a player drives it: taps, double
 * taps, drags, long presses, right-clicks and keys. Every screen case runs
 * twice: on a desktop with a mouse, and on a small landscape phone with a
 * finger, where a touch has to rest on a slot before it picks the item up.
 *
 * Then the real scene: `inventoryScreenScene.ts` runs the tutorial's bag step
 * and the dungeon's bag routes once per platform, each in its own process
 * because the platform is decided when the game's modules load.
 *
 *   npm run verify:inventory-screen
 */

import { spawnSync } from 'node:child_process';

import { createCanvas } from 'canvas';

import type { Inventory as InventoryT } from '../src/core/Inventory.js';
import type { ItemId } from '../src/core/ItemDefs.js';
import type { KeyModifiers, UiRoot as UiRootT } from '../src/ui/core/UiRoot.js';
import type {
  InventoryMember as Member,
  InventoryRestrictions as Restrictions,
} from '../src/ui/screens/inventory/inventoryTypes.js';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';

installCanvasGlobals();

const { Inventory } = await import('../src/core/Inventory.js');
const { SLOT_COUNT, ITEM_DEF, isItemId } = await import('../src/core/ItemDefs.js');
const { UiRoot } = await import('../src/ui/core/UiRoot.js');
const { MOUSE_POINTER_ID, PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { NO_INSETS } = await import('../src/ui/core/viewport.js');
const { InventoryActions } = await import('../src/ui/screens/inventory/InventoryActions.js');
const { InventoryScreen, LONG_PRESS_MS, TOUCH_PICKUP_HOLD_MS } =
  await import('../src/ui/screens/inventory/InventoryScreen.js');
const { RewardGrantedDialog } = await import('../src/ui/RewardGrantedDialog.js');
const { rewardGrantedSurface } = await import('../src/ui/screens/dialogs/rewardGrantedDialog.js');

const SECONDARY_BUTTON = 2;
const FRAME_MS = 16;
const SETTLE_FRAMES = 30;
const DRAG_STEPS = 4;
const FINGER_ID = 1;
/** Held past a threshold by this much, so the frame after it sees the hold as long enough. */
const HOLD_SLACK_MS = 50;
/** A touch that lifts this soon is a quick tap or swipe, well under every hold threshold. */
const QUICK_TOUCH_MS = 0;
/** Where a copy of a non-stacking item already sits on the bar. */
const COPY_ON_BAR_SLOT = 0;
const DIGIT_TWO_SLOT = 1;
const DIGIT_THREE_SLOT = 2;
/** The first slot past every stack the rig starts with: empty. */
const DRAG_TARGET_SLOT = 6;
const TUTORIAL_TARGET_SLOT = 0;
const HOTBAR_REARRANGE_FROM = 0;
const HOTBAR_REARRANGE_TO = 3;
const COMPANION_HOTBAR_SLOT = 2;
const REWARD_HOTBAR_SLOT = 5;
/** Bag slots the sort test scatters its stacks across, gaps between them. */
const SCATTERED_SLOTS = { fizz: 2, firstWood: 5, secondWood: 9, boots: 12 } as const;
/** The fizz, the folded wood and the boots. */
const SCATTERED_STACKS_AFTER_FOLDING = 3;
const BLOCKED_TRY_HOTBAR_SLOT = 3;
const WOOD_STACK = 10;
const SPLIT_STACK = 3;
const POTION_STACK = 2;
const CAT_POTIONS = 3;
/** The tome and the potions. */
const CAT_STACKS = 2;
/** Frames the reward card's icon takes to power up before its OK is there. */
const REWARD_SETTLE_FRAMES = 70;
const HELM_DOLL_KEY = 'Head:Hat';
const SEARCH_QUERY = 'pot';

const PLATFORMS = [
  {
    name: 'desktop',
    cssWidth: 1440,
    cssHeight: 900,
    density: 'pointer',
    source: 'mouse',
    pointerId: MOUSE_POINTER_ID,
  },
  {
    name: 'phone',
    cssWidth: 568,
    cssHeight: 320,
    density: 'touch',
    source: 'touch',
    pointerId: FINGER_ID,
  },
] as const;

type PlatformSpec = (typeof PLATFORMS)[number];

interface Tally {
  passed: number;
  failed: number;
}

const tallies = new Map<string, Tally>();
let scope = 'model';
function check(condition: boolean, label: string): void {
  const tally = tallies.get(scope) ?? { passed: 0, failed: 0 };
  tallies.set(scope, tally);
  if (condition) {
    tally.passed++;
    console.log(`  ok    ${label}`);
  } else {
    tally.failed++;
    console.log(`  FAIL  ${label}`);
  }
}

// ── Model ───────────────────────────────────────────────────────────────────

console.log('Inventory.sortBag');
{
  const inv = new Inventory('human');
  inv.bag.slots.fill(null);
  inv.actionBar.slots.fill(null);
  inv.bag.slots[SCATTERED_SLOTS.firstWood] = { ...ITEM_DEF.wood, quantity: SPLIT_STACK };
  inv.bag.slots[SCATTERED_SLOTS.fizz] = { ...ITEM_DEF.speed_fizz, quantity: 1 };
  inv.bag.slots[SCATTERED_SLOTS.secondWood] = { ...ITEM_DEF.wood, quantity: SPLIT_STACK };
  inv.bag.slots[SCATTERED_SLOTS.boots] = { ...ITEM_DEF.marching_boots, quantity: 1 };
  inv.actionBar.slots[0] = { ...ITEM_DEF.health_potion, quantity: 2 };
  inv.sortBag('manual');
  check(
    inv.bag.slots[0]?.id === 'speed_fizz' && inv.bag.slots[1]?.id === 'wood',
    'manual keeps slot order and closes the gaps',
  );
  check(inv.bag.slots[1]?.quantity === SPLIT_STACK * 2, 'split stacks are folded together');
  check(
    inv.bag.slots.slice(SCATTERED_STACKS_AFTER_FOLDING).every((slot) => slot === null),
    'every empty slot ends up at the end',
  );
  check(inv.actionBar.slots[0]?.id === 'health_potion', 'the hotbar is left alone');
  inv.sortBag('name');
  const names = inv.bag.slots.filter((slot) => slot !== null).map((slot) => slot.name);
  check(
    names.join('|') === [...names].sort((a, b) => a.localeCompare(b)).join('|'),
    'name sorts A–Z',
  );
  inv.sortBag('category');
  const firstCategory = inv.bag.slots[0] === null ? null : ITEM_DEF[inv.bag.slots[0].id].category;
  check(firstCategory === 'armor', 'category puts armor ahead of consumables and materials');
}

console.log('Inventory.addItem on a full bag');
{
  const inv = new Inventory('human');
  const spare = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => ITEM_DEF[id].isQuestItem !== true && !ITEM_DEF[id].stackable);
  let index = 0;
  while (inv.bag.slots.includes(null) && index < spare.length) inv.addItem(spare[index++], 1);
  const lost: { id: ItemId; quantity: number }[] = [];
  inv.setBagFullListener((id, quantity) => lost.push({ id, quantity }));
  const extra = spare[index];
  const stored = inv.addItem(extra, 1);
  check(!stored, 'addItem reports the loss');
  check(
    lost.length === 1 && lost[0]?.id === extra,
    'the bag-full listener hears which item was lost',
  );
  check(
    inv.bag.slots.filter((slot) => slot !== null).length === SLOT_COUNT,
    'capacity is unchanged',
  );
  check(
    inv.addItem('wood', 1) || inv.countOf('wood') === 0,
    'a stackable already held still stacks',
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Rig {
  readonly root: UiRootT;
  readonly inv: InventoryT;
  readonly catInv: InventoryT;
  readonly screen: InstanceType<typeof InventoryScreen>;
  readonly interaction: InstanceType<typeof InventoryActions>;
  readonly blocked: { count: number };
  readonly equipmentChanges: { count: number };
  readonly touch: boolean;
  restrictions: Restrictions;
  frame(): void;
  /** Draws frames until `ms` have passed on the rig's clock. */
  wait(ms: number): void;
  has(id: string): boolean;
  centre(id: string): Point;
  send(kind: 'down' | 'move' | 'up', at: Point, button?: number): void;
  tap(id: string): void;
  /** A right-click with a mouse; a finger held still past the long press on a phone. */
  openMenu(id: string): void;
  drag(fromId: string, toId: string): void;
  dragBetween(from: Point, to: Point, holdMs: number): void;
  key(key: string, mods?: KeyModifiers): void;
  /** Puts the phone's detail sheet away, so it covers nothing a later gesture aims at. */
  hideSheet(): void;
}

interface RigOptions {
  readonly companion?: boolean;
}

function makeRig(platform: PlatformSpec, opts: RigOptions = {}): Rig {
  let clock = 0;
  const touch = platform.source === 'touch';
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: platform.cssWidth,
      cssHeight: platform.cssHeight,
      density: platform.density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => clock,
    warn: () => undefined,
  });
  const inv = new Inventory('human');
  inv.bag.slots.fill(null);
  inv.actionBar.slots.fill(null);
  inv.addItem('dirty_shirley', 2);
  inv.addItem('wood', WOOD_STACK);
  inv.addItem('marching_boots', 1);
  inv.addItem('health_potion', POTION_STACK);
  inv.addItem('issue_kettle_helm', 1);
  inv.addItem('speed_fizz', 1);
  const catInv = new Inventory('cat');
  catInv.bag.slots.fill(null);
  catInv.actionBar.slots.fill(null);
  catInv.addItem('magic_missile_tome', 1);
  catInv.addItem('health_potion', CAT_POTIONS);
  const interaction = new InventoryActions();
  const blocked = { count: 0 };
  const equipmentChanges = { count: 0 };
  const ownerOf = (inventory: InventoryT): Member['owner'] => ({
    inventory,
    strength: 1,
    intelligence: 1,
    constitution: 1,
    dexterity: 1,
    onEquipmentChanged: () => {
      equipmentChanges.count++;
    },
  });
  const party: readonly Member[] = opts.companion
    ? [
        { id: 'human', name: 'Carl', owner: ownerOf(inv) },
        { id: 'cat', name: 'Donut', owner: ownerOf(catInv) },
      ]
    : [{ id: 'human', name: 'Carl', owner: ownerOf(inv) }];
  const canvas = createCanvas(platform.cssWidth, platform.cssHeight);
  const ctx = asGameContext(canvas.getContext('2d'));
  const send = (kind: 'down' | 'move' | 'up', at: Point, button: number = PRIMARY_BUTTON): void => {
    const scale = root.uiScale;
    root.pointer({
      kind,
      pointerId: platform.pointerId,
      source: platform.source,
      x: at.x,
      y: at.y,
      cssX: at.x * scale,
      cssY: at.y * scale,
      button,
      deltaY: 0,
    });
  };
  const rig: Rig = {
    root,
    inv,
    catInv,
    interaction,
    blocked,
    equipmentChanges,
    touch,
    restrictions: { contextMenu: true },
    screen: new InventoryScreen({
      actions: interaction,
      party: () => party,
      coins: () => 0,
      restrictions: () => rig.restrictions,
      onBlockedDrag: () => {
        blocked.count++;
      },
    }),
    frame: () => {
      clock += FRAME_MS;
      root.frame(ctx);
    },
    wait: (ms) => {
      const until = clock + ms;
      while (clock < until) rig.frame();
    },
    has: (id) => root.regions().some((r) => r.id === `inventory/${id}`),
    centre: (id) => {
      const region = root.regions().find((r) => r.id === `inventory/${id}`);
      if (region === undefined) throw new Error(`no region ${id}`);
      return { x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2 };
    },
    send,
    tap: (id) => {
      const at = rig.centre(id);
      send('down', at);
      send('up', at);
      rig.frame();
    },
    openMenu: (id) => {
      const at = rig.centre(id);
      if (touch) {
        send('down', at);
        rig.wait(LONG_PRESS_MS + HOLD_SLACK_MS);
        send('up', at);
      } else {
        send('down', at, SECONDARY_BUTTON);
        send('up', at, SECONDARY_BUTTON);
      }
      rig.frame();
    },
    dragBetween: (from, to, holdMs) => {
      send('down', from);
      if (holdMs > 0) rig.wait(holdMs);
      for (let step = 1; step <= DRAG_STEPS; step++) {
        const t = step / DRAG_STEPS;
        send('move', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        rig.frame();
      }
      send('up', to);
      rig.frame();
    },
    drag: (fromId, toId) => {
      rig.dragBetween(rig.centre(fromId), rig.centre(toId), pickupHold(touch));
    },
    key: (key, mods = {}) => {
      root.key(key, mods);
      rig.frame();
    },
    hideSheet: () => {
      if (rig.screen.sheetOpen) rig.key('Escape');
    },
  };
  root.mount(rig.screen.surface);
  rig.screen.open({ tab: 'bag' });
  for (let i = 0; i < SETTLE_FRAMES; i++) rig.frame();
  return rig;
}

/** How long a finger rests on a slot before it moves, so the move picks the item up. */
function pickupHold(touch: boolean): number {
  return touch ? TOUCH_PICKUP_HOLD_MS + HOLD_SLACK_MS : 0;
}

function slotOf(inv: InventoryT, id: ItemId): number {
  return inv.bag.slots.findIndex((slot) => slot?.id === id);
}

function bagIds(inv: InventoryT): string {
  return inv.bag.slots.map((slot) => slot?.id ?? '-').join(',');
}

/** The items the grid shows, in the order it shows them. */
function shownIds(rig: Rig, inv: InventoryT): ItemId[] {
  return rig.screen.geometry.order.flatMap((slotIdx) => {
    const item = inv.bag.slots[slotIdx] ?? null;
    return item === null ? [] : [item.id];
  });
}

/** Resolves an Equip or Unequip the screen queued, as `MenusKit.resolvePendingInventoryActions` does for the bag. */
function resolveEquipPending(rig: Rig): void {
  const actions = rig.interaction;
  const equipSlot = actions.pendingEquipSlot;
  if (equipSlot !== null && actions.pendingEquipSource === 'inv') {
    if (rig.inv.canEquipSlot(equipSlot)) rig.inv.equip(equipSlot);
  }
  actions.pendingEquipSlot = null;
  actions.pendingEquipSource = null;
  const unequipSlot = actions.pendingUnequipSlot;
  if (unequipSlot !== null && actions.pendingUnequipSource === 'inv') {
    const item = rig.inv.bag.slots[unequipSlot] ?? null;
    if (item !== null) rig.inv.unequipById(item.id);
  }
  actions.pendingUnequipSlot = null;
  actions.pendingUnequipSource = null;
  rig.frame();
}

function filterRegion(rig: Rig, filter: string): string {
  return rig.touch ? `chips/${filter}` : `rail/${filter}`;
}

function detailRegion(rig: Rig, action: string): string {
  return rig.touch ? `sheet/action-${action}` : `detail/action-${action}`;
}

function runScreenCases(platform: PlatformSpec): void {
  scope = platform.name;
  const on = `[${platform.name}]`;

  console.log(`\nInventoryScreen ${on}: select, keys, lead action`);
  {
    const rig = makeRig(platform);
    const shirley = slotOf(rig.inv, 'dirty_shirley');
    rig.tap(`bag/${shirley}`);
    check(rig.screen.selection?.id === 'dirty_shirley', 'a tap selects the stack');
    rig.key('2');
    check(
      rig.inv.actionBar.slots[DIGIT_TWO_SLOT]?.id === 'dirty_shirley',
      'a number key puts the selection on that hotbar slot',
    );
    rig.hideSheet();
    const potion = slotOf(rig.inv, 'health_potion');
    rig.tap(`bag/${potion}`);
    rig.tap(`bag/${potion}`);
    const drinkQueued = rig.interaction.pendingDrinkSlot?.id === 'health_potion';
    if (rig.touch) {
      check(
        rig.screen.sheetOpen && !drinkQueued,
        'on a phone a tap raises the detail sheet, whose Drink is the lead action',
      );
    } else {
      check(drinkQueued, 'a double tap queues the lead action (Drink)');
    }
    rig.interaction.pendingDrinkSlot = null;
    rig.hideSheet();
    const boots = slotOf(rig.inv, 'marching_boots');
    rig.tap(`bag/${boots}`);
    rig.key('3');
    check(
      rig.inv.actionBar.slots[DIGIT_THREE_SLOT] === null,
      'gear refuses the hotbar from a number key',
    );
    check(rig.screen.notice !== null, 'and says why');
  }

  console.log(`\nInventoryScreen ${on}: a number key moves the stack that was picked`);
  {
    const rig = makeRig(platform);
    rig.inv.actionBar.slots[COPY_ON_BAR_SLOT] = { ...ITEM_DEF.slingshot, quantity: 1 };
    rig.inv.addItem('slingshot', 1);
    rig.frame();
    const picked = slotOf(rig.inv, 'slingshot');
    rig.tap(`bag/${picked}`);
    rig.key('3');
    check(
      rig.inv.actionBar.slots[DIGIT_THREE_SLOT]?.id === 'slingshot' &&
        rig.inv.actionBar.slots[COPY_ON_BAR_SLOT]?.id === 'slingshot' &&
        rig.inv.bag.slots[picked]?.id !== 'slingshot',
      'the bag copy goes to the bar; the copy already there stays put',
    );
  }

  console.log(`\nInventoryScreen ${on}: context menu`);
  {
    const rig = makeRig(platform);
    const wood = slotOf(rig.inv, 'wood');
    if (rig.touch) {
      const at = rig.centre(`bag/${wood}`);
      rig.send('down', at);
      rig.wait(TOUCH_PICKUP_HOLD_MS);
      rig.send('up', at);
      rig.frame();
      check(rig.screen.menu === null, 'a finger lifted before the long press opens no menu');
      rig.hideSheet();
    }
    rig.openMenu(`bag/${wood}`);
    check(
      rig.screen.menu?.kind === 'item',
      rig.touch ? 'a finger held still opens the item menu' : 'a right-click opens the item menu',
    );
    if (rig.touch) {
      check(!rig.screen.sheetOpen, 'and the lift that ends the hold does not also tap the slot');
    }
    rig.tap('item-menu/drop');
    check(rig.interaction.pendingQuantityPrompt?.id === 'wood', 'Drop on a stack asks how many');
  }

  console.log(`\nInventoryScreen ${on}: drag`);
  {
    const rig = makeRig(platform);
    const wood = slotOf(rig.inv, 'wood');
    if (rig.touch) {
      const before = bagIds(rig.inv);
      rig.dragBetween(
        rig.centre(`bag/${wood}`),
        rig.centre(`bag/${DRAG_TARGET_SLOT}`),
        QUICK_TOUCH_MS,
      );
      check(
        bagIds(rig.inv) === before && rig.screen.drag === null,
        'a finger that moves at once swipes the grid and moves nothing',
      );
    }
    rig.drag(`bag/${wood}`, `bag/${DRAG_TARGET_SLOT}`);
    check(
      rig.inv.bag.slots[DRAG_TARGET_SLOT]?.id === 'wood' && rig.inv.bag.slots[wood] === null,
      'a drag rearranges the bag in the All view',
    );
    const shirley = slotOf(rig.inv, 'dirty_shirley');
    rig.drag(`bag/${shirley}`, `hotbar/${HOTBAR_REARRANGE_FROM}`);
    check(
      rig.inv.actionBar.slots[HOTBAR_REARRANGE_FROM]?.id === 'dirty_shirley',
      'a drag puts an item on the hotbar',
    );
    rig.drag(`hotbar/${HOTBAR_REARRANGE_FROM}`, `hotbar/${HOTBAR_REARRANGE_TO}`);
    check(
      rig.inv.actionBar.slots[HOTBAR_REARRANGE_TO]?.id === 'dirty_shirley' &&
        rig.inv.actionBar.slots[HOTBAR_REARRANGE_FROM] === null,
      'a drag along the hotbar rearranges it',
    );

    rig.tap(filterRegion(rig, 'consumable'));
    check(rig.screen.filter === 'consumable', 'the category filter narrows the grid');
    check(
      shownIds(rig, rig.inv).every((id) => ITEM_DEF[id].category === 'consumable'),
      'to that category only',
    );
    const potion = slotOf(rig.inv, 'health_potion');
    const fizz = slotOf(rig.inv, 'speed_fizz');
    const beforeFiltered = bagIds(rig.inv);
    rig.drag(`bag/${potion}`, `bag/${fizz}`);
    check(
      bagIds(rig.inv) === beforeFiltered && !rig.screen.isRearrangeable(),
      'a filtered view does not rearrange',
    );
    rig.drag(`bag/${potion}`, 'hotbar/1');
    check(
      rig.inv.actionBar.slots[1]?.id === 'health_potion',
      'but a filtered view still drags to the hotbar',
    );
    rig.tap(filterRegion(rig, 'all'));
    check(rig.screen.filter === 'all', 'All shows everything again');
    rig.tap('tidy');
    check(
      rig.inv.bag.slots
        .slice(0, rig.inv.bag.slots.filter((slot) => slot !== null).length)
        .every((slot) => slot !== null),
      'Tidy closes the gaps',
    );
  }

  console.log(`\nInventoryScreen ${on}: search`);
  {
    const rig = makeRig(platform);
    const everything = shownIds(rig, rig.inv).length;
    rig.key('w', { repeat: true });
    check(rig.screen.search.value === '', 'a key before the field is active types nothing');
    rig.tap('search');
    check(rig.screen.search.active, 'a tap on the field starts typing');
    rig.key('w', { repeat: true });
    check(
      rig.screen.search.value === '',
      'an auto-repeat of a key held from before the field took keys types nothing',
    );
    for (const letter of SEARCH_QUERY) rig.key(letter);
    check(rig.screen.search.value === SEARCH_QUERY, `typed keys spell "${SEARCH_QUERY}"`);
    const shown = shownIds(rig, rig.inv);
    check(
      shown.length === 1 && shown[0] === 'health_potion',
      `the grid shows only what matches (${shown.join(', ')})`,
    );
    check(!rig.screen.isRearrangeable(), 'a searched view does not rearrange');
    const lastLetter = SEARCH_QUERY[SEARCH_QUERY.length - 1];
    rig.key(lastLetter, { repeat: true });
    check(
      rig.screen.search.value === SEARCH_QUERY + lastLetter,
      'an auto-repeat of a key struck while typing does type',
    );
    rig.key('Backspace');
    check(rig.screen.search.value === SEARCH_QUERY, 'Backspace erases a letter');
    for (const _letter of SEARCH_QUERY) rig.key('Backspace');
    check(
      rig.screen.search.value === '' && shownIds(rig, rig.inv).length === everything,
      'erasing the query shows the whole bag again',
    );
    rig.key('Escape');
    check(
      !rig.screen.search.active && rig.screen.isOpen,
      'Escape stops typing and leaves the screen open',
    );
    rig.key('x');
    check(rig.screen.search.value === '', 'a key after Escape types nothing');
  }

  console.log(`\nInventoryScreen ${on}: sort and tidy`);
  {
    const rig = makeRig(platform);
    const before = bagIds(rig.inv);
    rig.tap('sort');
    check(rig.screen.menu?.kind === 'sort', 'the Sort control opens its menu');
    rig.tap('sort-menu/name');
    check(rig.screen.sort === 'name', 'Name is picked');
    const names = shownIds(rig, rig.inv).map((id) => ITEM_DEF[id].name);
    check(
      names.join('|') === [...names].sort((a, b) => a.localeCompare(b)).join('|'),
      `the grid is shown A–Z (${names.join(', ')})`,
    );
    check(bagIds(rig.inv) === before, 'and the bag’s own slots are untouched');
    check(!rig.screen.isRearrangeable(), 'a sorted view does not rearrange');
    rig.tap('tidy');
    const tidied = rig.inv.bag.slots.filter((slot) => slot !== null).map((slot) => slot.name);
    check(
      tidied.join('|') === [...tidied].sort((a, b) => a.localeCompare(b)).join('|') &&
        rig.screen.sort === 'manual',
      'Tidy writes the shown order into the bag and returns to manual',
    );
  }

  console.log(`\nInventoryScreen ${on}: equip from the Bag tab`);
  {
    const rig = makeRig(platform);
    const helm = slotOf(rig.inv, 'issue_kettle_helm');
    rig.openMenu(`bag/${helm}`);
    check(rig.has('item-menu/equip'), 'gear’s menu offers Equip');
    rig.tap('item-menu/equip');
    check(
      rig.interaction.pendingEquipSlot === helm && rig.interaction.pendingEquipSource === 'inv',
      'Equip queues the slot for the scene',
    );
    resolveEquipPending(rig);
    check(rig.inv.hasEquipped('issue_kettle_helm'), 'which puts it on');
    rig.openMenu(`bag/${helm}`);
    check(rig.has('item-menu/unequip'), 'worn gear’s menu offers Unequip');
    rig.tap('item-menu/unequip');
    check(
      rig.interaction.pendingUnequipSlot === helm && rig.interaction.pendingUnequipSource === 'inv',
      'Unequip queues the slot for the scene',
    );
    resolveEquipPending(rig);
    check(!rig.inv.hasEquipped('issue_kettle_helm'), 'which takes it off');
    rig.tap(`bag/${helm}`);
    check(rig.has(detailRegion(rig, 'Equip')), 'the detail pane offers Equip');
    rig.tap(detailRegion(rig, 'Equip'));
    check(
      rig.interaction.pendingEquipSlot === helm && rig.interaction.pendingEquipSource === 'inv',
      'the detail pane’s Equip queues the slot too',
    );
    resolveEquipPending(rig);
  }

  console.log(`\nInventoryScreen ${on}: the Character tab`);
  {
    const rig = makeRig(platform);
    rig.tap('tabs/character');
    check(rig.screen.tab === 'character', 'the Character tab opens');
    const helm = slotOf(rig.inv, 'issue_kettle_helm');
    check(
      shownIds(rig, rig.inv).every((id) => ITEM_DEF[id].type === 'armor'),
      'its grid shows only what can be worn',
    );
    const changes = rig.equipmentChanges.count;
    rig.tap(`bag/${helm}`);
    check(
      rig.inv.getEquippedItem(HELM_DOLL_KEY)?.id === 'issue_kettle_helm' &&
        rig.equipmentChanges.count === changes + 1,
      'a tap on gear in the grid puts it on',
    );
    rig.tap(`doll/${HELM_DOLL_KEY}`);
    check(
      rig.inv.getEquippedItem(HELM_DOLL_KEY) === null,
      'a tap on a filled doll cell takes it off',
    );
    rig.drag(`bag/${helm}`, `doll/${HELM_DOLL_KEY}`);
    check(
      rig.inv.getEquippedItem(HELM_DOLL_KEY)?.id === 'issue_kettle_helm',
      'a drag from the grid onto the doll puts it on',
    );
    const grid = rig.screen.geometry.grid;
    if (grid === null) throw new Error('the Character tab drew no grid');
    rig.dragBetween(
      rig.centre(`doll/${HELM_DOLL_KEY}`),
      { x: grid.x + grid.w / 2, y: grid.y + grid.h / 2 },
      pickupHold(rig.touch),
    );
    check(
      rig.inv.getEquippedItem(HELM_DOLL_KEY) === null,
      'a drag from the doll back onto the grid takes it off',
    );
  }

  console.log(`\nInventoryScreen ${on}: the companion’s pack`);
  {
    const rig = makeRig(platform, { companion: true });
    check(rig.has('switcher'), 'with two in the party the header offers a switcher');
    rig.tap('switcher');
    check(rig.screen.menu?.kind === 'party', 'which opens the party menu');
    rig.tap('party-menu/cat');
    check(rig.screen.member()?.id === 'cat', 'picking the cat shows her pack');
    const shown = shownIds(rig, rig.catInv);
    check(
      shown.includes('magic_missile_tome') && shown.length === CAT_STACKS,
      `the grid is hers (${shown.join(', ')})`,
    );
    const potion = slotOf(rig.catInv, 'health_potion');
    rig.drag(`bag/${potion}`, `hotbar/${COMPANION_HOTBAR_SLOT}`);
    check(
      rig.catInv.actionBar.slots[COMPANION_HOTBAR_SLOT]?.id === 'health_potion' &&
        rig.inv.actionBar.slots[COMPANION_HOTBAR_SLOT] === null,
      'a drag there moves her items, not his',
    );
  }

  console.log(`\nInventoryScreen ${on}: tutorial restrictions`);
  {
    const rig = makeRig(platform);
    rig.restrictions = {
      allowedSource: 'health_potion',
      allowedHotbarTarget: 1,
      contextMenu: true,
    };
    rig.frame();
    const wood = slotOf(rig.inv, 'wood');
    rig.drag(`bag/${wood}`, 'hotbar/1');
    check(rig.inv.actionBar.slots[1] === null, 'only the allowed item can be dragged');
    const potion = slotOf(rig.inv, 'health_potion');
    rig.drag(`bag/${potion}`, `hotbar/${TUTORIAL_TARGET_SLOT}`);
    check(
      rig.inv.actionBar.slots[TUTORIAL_TARGET_SLOT] === null,
      'only the allowed slot accepts it',
    );
    rig.drag(`bag/${slotOf(rig.inv, 'health_potion')}`, 'hotbar/1');
    check(rig.inv.actionBar.slots[1]?.id === 'health_potion', 'the allowed drag lands');
    rig.openMenu(`bag/${slotOf(rig.inv, 'wood')}`);
    check(rig.screen.menu === null, 'no context menu while a drag is being steered');
    rig.hideSheet();

    const woodSlot = slotOf(rig.inv, 'wood');
    rig.tap(`bag/${woodSlot}`);
    rig.tap(`bag/${woodSlot}`);
    check(
      rig.interaction.pendingDropItem === null && rig.interaction.pendingQuantityPrompt === null,
      'nothing queued by a double tap while steered',
    );
    rig.screen.deselect();
    rig.frame();
    rig.inv.addItem('dirty_shirley', 1);
    rig.frame();
    const shirley = slotOf(rig.inv, 'dirty_shirley');
    rig.tap(`bag/${shirley}`);
    rig.tap(`bag/${shirley}`);
    check(
      rig.interaction.pendingDrinkSlot === null,
      'a double tap runs no lead action while steered',
    );
    rig.tap(detailRegion(rig, 'Drop'));
    check(
      rig.interaction.pendingDropItem === null && rig.interaction.pendingQuantityPrompt === null,
      'the detail pane cannot drop while steered',
    );
    rig.key('Enter');
    check(rig.interaction.pendingDrinkSlot === null, 'Enter runs no lead action while steered');
    rig.hideSheet();

    rig.restrictions = { blockedItems: ['marching_boots'], contextMenu: true };
    rig.frame();
    rig.drag(`bag/${slotOf(rig.inv, 'marching_boots')}`, `hotbar/${BLOCKED_TRY_HOTBAR_SLOT}`);
    check(rig.blocked.count === 1, 'a blocked item reports the attempt');
    check(rig.inv.actionBar.slots[BLOCKED_TRY_HOTBAR_SLOT] === null, 'and does not move');
  }

  console.log(`\nInventoryScreen ${on}: a reward card raised mid-drag`);
  runRewardMidDrag(platform);
}

/**
 * A reward card that comes up while an item is in hand covers the screen; the
 * release that follows, over a hotbar cell, must neither land the item nor
 * reach the card.
 */
function runRewardMidDrag(platform: PlatformSpec): void {
  const rig = makeRig(platform);
  const dialog = new RewardGrantedDialog();
  let acknowledged = 0;
  rig.root.mount(
    rewardGrantedSurface('reward-granted', {
      get view() {
        return dialog.view;
      },
      acknowledge: () => {
        acknowledged++;
        dialog.acknowledge();
      },
    }),
  );
  const shirley = slotOf(rig.inv, 'dirty_shirley');
  const from = rig.centre(`bag/${shirley}`);
  const to = rig.centre(`hotbar/${REWARD_HOTBAR_SLOT}`);
  const halfway = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  rig.send('down', from);
  rig.wait(pickupHold(rig.touch));
  rig.send('move', halfway);
  rig.frame();
  check(rig.screen.drag?.item.id === 'dirty_shirley', 'the item is in hand');
  dialog.enqueue({
    kind: 'item',
    name: 'Click-through',
    description: 'Raised while an item is being dragged.',
    renderIcon: () => undefined,
  });
  for (let i = 0; i < REWARD_SETTLE_FRAMES; i++) {
    dialog.update();
    rig.frame();
  }
  check(
    dialog.view?.settled === true && rig.root.isOpen('reward-granted'),
    'the reward card is up, settled, with its OK',
  );
  rig.send('move', to);
  rig.frame();
  rig.send('up', to);
  rig.frame();
  check(
    rig.inv.actionBar.slots[REWARD_HOTBAR_SLOT] === null &&
      rig.inv.bag.slots[shirley]?.id === 'dirty_shirley',
    'the release over the hotbar under the card moves nothing',
  );
  check(rig.screen.drag === null, 'and lets go of the item');
  check(acknowledged === 0 && dialog.view !== null, 'and does not tap the card');
}

for (const platform of PLATFORMS) runScreenCases(platform);

// ── The real scene ──────────────────────────────────────────────────────────

scope = 'scene';
console.log('\nThe real dungeon scene, on a desktop and on a phone');
for (const platform of PLATFORMS) {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, 'scripts/inventoryScreenScene.ts', `--platform=${platform.name}`],
    { stdio: 'inherit' },
  );
  check(child.status === 0, `the scene's inventory cases hold on ${platform.name}`);
}

console.log('\nSummary');
let failures = 0;
for (const [name, tally] of tallies) {
  failures += tally.failed;
  console.log(`  ${name}: ${tally.passed} passed, ${tally.failed} failed`);
}
if (failures > 0) {
  console.log(`\nverify:inventory-screen FAILED (${failures})`);
  process.exit(1);
}
console.log('\nverify:inventory-screen passed');
