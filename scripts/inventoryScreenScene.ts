/**
 * The scene half of `verify:inventory-screen`: the real `DungeonScene`,
 * headless on one platform, with its inventory screen driven through the
 * scene's own `UiRoot` by the pointer gestures the browser would send and
 * keys dispatched on the window. The scene's UI clock is real time, so every
 * touch hold here is really waited out.
 *
 *  - The tutorial's bag step, opened from the pause menu's Inventory entry:
 *    the Smush tome and the potions dragged to the slots it asks for, the
 *    boxers refusing the hotbar with the tutorial's hint, then put on from
 *    their context menu until the tutorial moves on.
 *  - A plain dungeon floor: I and G, the HUD's Bag button, a potion drunk from
 *    the bag, and a stack dropped through "how many?".
 *
 * Run by `verify-inventory-screen.ts` once per platform, in a child process:
 * the platform is decided once, when the game's modules load.
 *
 *   npx tsx scripts/inventoryScreenScene.ts --platform=desktop|phone
 */

import type { ItemId } from '../src/core/ItemDefs.js';

const platformArg = process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1];
const onPhone = platformArg === 'phone';

const PHONE = { width: 568, height: 320, devicePixelRatio: 1 } as const;
const DESKTOP = { width: 1440, height: 900, devicePixelRatio: 1 } as const;
const VIEWPORT = onPhone ? PHONE : DESKTOP;

Object.defineProperty(globalThis, 'navigator', {
  value: onPhone
    ? { maxTouchPoints: 1, userAgent: 'iPhone' }
    : { maxTouchPoints: 0, userAgent: 'Desktop' },
  configurable: true,
});

const { installBrowserShim, ShimEvent } = await import('./browserShim.js');
const shim = installBrowserShim(VIEWPORT);
const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { gameContext } = await import('./nodeGameContext.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { getLevelDef } = await import('../src/levels/index.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { TutorialController } = await import('../src/systems/TutorialController.js');
const { LoadingOverlay } = await import('../src/ui/LoadingScreen.js');
const { MOUSE_POINTER_ID, PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { toCssRect } = await import('../src/ui/hud/HudSurface.js');
const { LONG_PRESS_MS, TOUCH_PICKUP_HOLD_MS } =
  await import('../src/ui/screens/inventory/InventoryScreen.js');

type Scene = InstanceType<typeof DungeonScene>;
type GestureKind = 'down' | 'move' | 'up';
interface Point {
  readonly x: number;
  readonly y: number;
}
interface Rect extends Point {
  readonly w: number;
  readonly h: number;
}

/** More frames than any arrival screen ever needs to finish its work. */
const MAX_ARRIVAL_FRAMES = 3000;
const SECONDARY_BUTTON = 2;
const FINGER_ID = 1;
const DRAG_STEPS = 4;
/** Held past a threshold by this much, so the frame after it sees the hold as long enough. */
const HOLD_SLACK_MS = 80;
/** Scene ticks after an action, so whatever reads it on its next update has. */
const SETTLE_TICKS = 3;
const SMUSH_HOTBAR_SLOT = 0;
const POTION_HOTBAR_SLOT = 1;
const BOXERS_TRY_HOTBAR_SLOT = 2;
const DRINK_POTIONS = 3;
/** Taken off the human so a potion has something to heal. */
const WOUND_HP = 5;
const DROP_STACK = 5;
const PAUSE_SURFACE_ID = 'pause';
const PICKER_SURFACE_ID = 'item-picker';

let failures = 0;
let passes = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (ok) passes++;
  else failures++;
}

function section(title: string): void {
  console.log(`\n── ${onPhone ? 'phone' : 'desktop'} scene: ${title}`);
}

function centre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await loadSprites('src/images/');
setViewportSize(VIEWPORT.width, VIEWPORT.height);
const ctx = gameContext(VIEWPORT.width, VIEWPORT.height);

const pointerSource = onPhone ? 'touch' : 'mouse';
const pointerId = onPhone ? FINGER_ID : MOUSE_POINTER_ID;
let clock = 0;

/** One gesture through the scene's stack, in canvas CSS pixels, as `PointerInput` would send it. */
function send(scene: Scene, kind: GestureKind, at: Point, button: number = PRIMARY_BUTTON): void {
  clock += 1;
  const scale = scene.ui.uiScale;
  scene.ui.pointer({
    kind,
    pointerId,
    source: pointerSource,
    x: at.x / scale,
    y: at.y / scale,
    cssX: at.x,
    cssY: at.y,
    button,
    deltaY: 0,
    timeStamp: clock,
  });
}

function frame(scene: Scene): void {
  scene.render(ctx);
}

/** Lets the scene run its update a few times, drawing each. */
function tick(scene: Scene, times: number = SETTLE_TICKS): void {
  for (let i = 0; i < times; i++) {
    scene.update();
    scene.render(ctx);
  }
}

/** A key pressed and released on the window, the way the browser delivers it. */
function pressKey(scene: Scene, key: string): void {
  clock += 1;
  shim.window.dispatch(new ShimEvent('keydown', key, clock));
  shim.window.dispatch(new ShimEvent('keyup', key, clock));
  frame(scene);
}

function tap(scene: Scene, at: Point, button: number = PRIMARY_BUTTON): void {
  frame(scene);
  send(scene, 'down', at, button);
  send(scene, 'up', at, button);
  frame(scene);
}

/**
 * Two quick taps with one frame drawn between them, as a browser would draw
 * at least one in the gap. Frames are slow headless, so no more than one is
 * drawn: the gap has to stay inside the double-tap window.
 */
function doubleTap(scene: Scene, at: Point): void {
  frame(scene);
  send(scene, 'down', at);
  send(scene, 'up', at);
  frame(scene);
  send(scene, 'down', at);
  send(scene, 'up', at);
  frame(scene);
}

/** A press held still for `ms` of real time, with frames drawn on either side of the wait. */
async function holdDown(scene: Scene, at: Point, ms: number): Promise<void> {
  frame(scene);
  send(scene, 'down', at);
  frame(scene);
  await sleep(ms);
  frame(scene);
}

/** A drag from `from` to `to`; on a phone the finger first rests long enough to pick the item up. */
async function drag(scene: Scene, from: Point, to: Point): Promise<void> {
  if (onPhone) {
    await holdDown(scene, from, TOUCH_PICKUP_HOLD_MS + HOLD_SLACK_MS);
  } else {
    frame(scene);
    send(scene, 'down', from);
  }
  for (let step = 1; step <= DRAG_STEPS; step++) {
    const t = step / DRAG_STEPS;
    send(scene, 'move', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    frame(scene);
  }
  send(scene, 'up', to);
  frame(scene);
}

/** A right-click with a mouse; a finger held still past the long press on a phone. */
async function openContextMenu(scene: Scene, at: Point): Promise<void> {
  if (onPhone) {
    await holdDown(scene, at, LONG_PRESS_MS + HOLD_SLACK_MS);
    send(scene, 'up', at);
    frame(scene);
  } else {
    tap(scene, at, SECONDARY_BUTTON);
  }
}

async function settleArrival(scene: Scene): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ARRIVAL_FRAMES; attempt++) {
    const loading: unknown = Reflect.get(scene, 'arrivalLoading');
    if (!(loading instanceof LoadingOverlay) || !loading.isOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

/** A registered region's centre in CSS pixels, or null when the last frame did not draw it. */
function regionPoint(
  scene: Scene,
  matches: (id: string, surfaceId: string) => boolean,
): Point | null {
  const region = scene.ui.regions().find((r) => matches(r.id, r.surfaceId));
  return region === undefined ? null : centre(toCssRect(region.rect, scene.ui.uiScale));
}

function requireRegion(scene: Scene, id: string): Point {
  const at = regionPoint(scene, (regionId) => regionId === id);
  if (at === null) throw new Error(`the scene drew no region ${id}`);
  return at;
}

function bagCell(scene: Scene, id: ItemId): Point {
  const menus = scene['menus'];
  const slot = menus.inventoryPlayer().inventory.bag.slots.findIndex((item) => item?.id === id);
  const rect = menus.inventoryScreen.geometry.bagCells.get(slot);
  if (rect === undefined) throw new Error(`${id} is not on screen in the bag`);
  return centre(toCssRect(rect, scene.ui.uiScale));
}

function hotbarCell(scene: Scene, index: number): Point {
  const rect = scene['menus'].inventoryScreen.geometry.hotbarCells.get(index);
  if (rect === undefined) throw new Error(`the bag's hotbar row drew no slot ${index}`);
  return centre(toCssRect(rect, scene.ui.uiScale));
}

const sceneManager = new SceneManager();

// ── The tutorial's bag step ────────────────────────────────────────────────

section('the tutorial’s bag step, from the pause menu');
{
  const tutorial = TutorialController.createForTutorial();
  const scene = new DungeonScene(getLevelDef('tutorial'), new InputManager(), sceneManager, {
    tutorialController: tutorial,
    skipIntro: true,
  });
  sceneManager.replace(scene);
  check(await settleArrival(scene), 'the tutorial floor finishes arriving');
  frame(scene);
  const human = scene['human'];
  const menus = scene['menus'];
  const screen = menus.inventoryScreen;
  tutorial.onHumanRewardDialogDismissed(human);
  tick(scene);
  check(tutorial.state === 'HUMAN_OPENED_ACHIEVEMENT', 'the tutorial is at its bag step');

  scene['togglePause']();
  tick(scene, 1);
  check(menus.pauseScreen.isOpen, 'the pause menu is open');
  const inventoryEntry = regionPoint(
    scene,
    (id, surfaceId) => surfaceId === PAUSE_SURFACE_ID && id.endsWith('/inventory'),
  );
  check(inventoryEntry !== null, 'and offers its Inventory entry');
  if (inventoryEntry !== null) tap(scene, inventoryEntry);
  tick(scene, 1);
  check(
    screen.isOpen && screen.tab === 'bag' && screen.member()?.id === 'human',
    'which opens the human’s bag',
  );
  check(!menus.pauseScreen.isOpen, 'in place of the pause menu');

  await drag(scene, bagCell(scene, 'smush_tome'), hotbarCell(scene, SMUSH_HOTBAR_SLOT));
  tick(scene);
  check(
    human.inventory.actionBar.slots[SMUSH_HOTBAR_SLOT]?.id === 'smush_tome',
    'the Smush tome is dragged to hotbar slot 1',
  );
  check(tutorial.tutorialDragItemId === 'health_potion', 'and the tutorial asks for the potions');

  await drag(scene, bagCell(scene, 'health_potion'), hotbarCell(scene, POTION_HOTBAR_SLOT));
  tick(scene);
  check(
    human.inventory.actionBar.slots[POTION_HOTBAR_SLOT]?.id === 'health_potion',
    'the potions are dragged to hotbar slot 2',
  );
  check(
    tutorial.tutorialBlockedDragItemId === 'enchanted_bigboi_boxers',
    'and the tutorial asks for the boxers to be put on',
  );

  const boxersSlot = human.inventory.bag.slots.findIndex(
    (item) => item?.id === 'enchanted_bigboi_boxers',
  );
  await drag(
    scene,
    bagCell(scene, 'enchanted_bigboi_boxers'),
    hotbarCell(scene, BOXERS_TRY_HOTBAR_SLOT),
  );
  const hintTimer: unknown = Reflect.get(tutorial, '_boxersDragHintTimer');
  tick(scene, 1);
  check(
    human.inventory.actionBar.slots[BOXERS_TRY_HOTBAR_SLOT] === null &&
      human.inventory.bag.slots[boxersSlot]?.id === 'enchanted_bigboi_boxers',
    'a drag of the boxers to the hotbar moves nothing',
  );
  check(
    typeof hintTimer === 'number' && hintTimer > 0,
    'and raises the tutorial’s hint about them',
  );

  await openContextMenu(scene, bagCell(scene, 'enchanted_bigboi_boxers'));
  check(
    screen.menu?.kind === 'item' && screen.menu.target.item.id === 'enchanted_bigboi_boxers',
    onPhone
      ? 'a finger held on the boxers opens their context menu'
      : 'a right-click on the boxers opens their context menu',
  );
  const equip = regionPoint(scene, (id) => id === 'inventory/item-menu/equip');
  check(equip !== null, 'which offers Equip');
  if (equip !== null) tap(scene, equip);
  check(
    human.inventory.equipment.getEquippedId('Legs:Pants') === 'enchanted_bigboi_boxers',
    'Equip puts the boxers on through the scene',
  );
  tick(scene);
  check(tutorial.state === 'HUMAN_EQUIPPED_SMUSH', 'and the tutorial moves on');
  check(!screen.isOpen && !menus.pauseScreen.isOpen, 'closing the bag behind it');
}

// ── A plain dungeon floor ──────────────────────────────────────────────────

section('a dungeon floor');
{
  const scene = new DungeonScene(getLevelDef('level1'), new InputManager(), sceneManager, {
    worldSeed: WORLD_SEED,
    skipIntro: true,
  });
  sceneManager.replace(scene);
  check(await settleArrival(scene), 'the floor finishes arriving');
  tick(scene);
  const menus = scene['menus'];
  const screen = menus.inventoryScreen;
  const human = scene['human'];
  if (!human.isActive) scene['triggerSwitchCharacter'](true);
  tick(scene, 1);

  pressKey(scene, 'i');
  check(screen.isOpen && screen.tab === 'bag', 'I opens the Bag tab');
  pressKey(scene, 'g');
  check(screen.isOpen && screen.tab === 'character', 'G switches it to the Character tab');
  pressKey(scene, 'g');
  check(!screen.isOpen, 'G again closes it');
  tick(scene, 1);

  const hudFrame = scene['hud'].frame;
  const bagRect = hudFrame?.dock.get('bag');
  check(bagRect !== undefined, 'the HUD draws a Bag button');
  if (hudFrame !== null && bagRect !== undefined) {
    tap(scene, centre(toCssRect(bagRect, hudFrame.uiScale)));
    check(screen.isOpen && screen.tab === 'bag', 'and a tap on it opens the bag');
    screen.close();
    tick(scene, 1);
  }

  section('a potion drunk from the bag');
  human.inventory.addItem('health_potion', DRINK_POTIONS);
  for (let index = 0; index < human.inventory.actionBar.slots.length; index++) {
    if (human.inventory.actionBar.slots[index]?.id === 'health_potion') {
      human.inventory.moveHotbarToFirstEmptySlot(index);
    }
  }
  human.hp = Math.max(1, human.maxHp - WOUND_HP);
  const potionsBefore = human.inventory.countOf('health_potion');
  pressKey(scene, 'i');
  const potion = bagCell(scene, 'health_potion');
  tap(scene, potion);
  doubleTap(scene, potion);
  tick(scene, 1);
  const drankByDoubleTap = human.inventory.countOf('health_potion') === potionsBefore - 1;
  if (onPhone) {
    check(!drankByDoubleTap, 'on a phone a second tap lands on the detail sheet, not the slot');
    const drink = regionPoint(scene, (id) => id === 'inventory/sheet/action-Drink');
    check(drink !== null, 'the tap opened the detail sheet with Drink, the lead action');
    if (drink !== null) tap(scene, drink);
    tick(scene, 1);
  } else {
    check(drankByDoubleTap, 'a double-click on a potion drinks it');
  }
  check(
    human.inventory.countOf('health_potion') === potionsBefore - 1,
    `one potion goes down (${potionsBefore} → ${human.inventory.countOf('health_potion')})`,
  );
  check(!screen.isOpen, 'and the bag closes to let the fight go on');

  section('a stack dropped through “how many?”');
  human.inventory.addItem('wood', DROP_STACK);
  const woodBefore = human.inventory.countOf('wood');
  pressKey(scene, 'i');
  await openContextMenu(scene, bagCell(scene, 'wood'));
  check(screen.menu?.kind === 'item', 'the wood’s context menu is open');
  tap(scene, requireRegion(scene, 'inventory/item-menu/drop'));
  tick(scene, 1);
  check(scene.ui.isOpen(PICKER_SURFACE_ID), 'Drop on a stack asks how many');
  const confirm = regionPoint(
    scene,
    (id, surfaceId) => surfaceId === PICKER_SURFACE_ID && id.endsWith('/confirm'),
  );
  check(confirm !== null, 'with a confirm button');
  if (confirm !== null) tap(scene, confirm);
  tick(scene, 1);
  check(!scene.ui.isOpen(PICKER_SURFACE_ID), 'which closes the question');
  check(
    human.inventory.countOf('wood') === woodBefore - 1,
    `and drops the one asked for (${woodBefore} → ${human.inventory.countOf('wood')})`,
  );
  const pending: unknown = Reflect.get(scene['destruction'].loot, 'pendingLoots');
  const dropped =
    Array.isArray(pending) &&
    pending.some((pile: unknown) => {
      if (typeof pile !== 'object' || pile === null) return false;
      const loot: unknown = Reflect.get(pile, 'loot');
      if (typeof loot !== 'object' || loot === null) return false;
      const items: unknown = Reflect.get(loot, 'items');
      return (
        Reflect.get(pile, 'droppedByPlayer') === true &&
        Array.isArray(items) &&
        items.some(
          (item: unknown) =>
            typeof item === 'object' && item !== null && Reflect.get(item, 'id') === 'wood',
        )
      );
    });
  check(dropped, 'onto the floor');
}

console.log(
  `\n${onPhone ? 'phone' : 'desktop'} scene: ${passes} passed, ${failures} failed` +
    (failures === 0 ? '.' : ' — FAILED.'),
);
process.exit(failures === 0 ? 0 : 1);
