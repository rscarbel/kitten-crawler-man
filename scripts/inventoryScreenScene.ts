/**
 * The scene half of `verify:inventory-screen`: the real `DungeonScene`,
 * headless on one platform, with its inventory screen driven through the
 * scene's own `UiRoot` by the pointer gestures the browser would send and
 * keys dispatched on the window. The scene's UI clock is real time, so every
 * touch hold here is really waited out.
 *
 *  - The tutorial's bag step, opened from the pause menu's Inventory entry:
 *    the Seismic Stomp tome and the potions dragged to the slots it asks for, the
 *    hoodie refusing the hotbar with the tutorial's hint, then put on from
 *    their context menu until the tutorial moves on.
 *  - A plain dungeon floor: I and G, the HUD's Bag button, a potion drunk from
 *    the bag, the cat's drink refused to the human and drunk by her, a stack
 *    dropped through "how many?", and the HUD's own hotbar taking drags beside
 *    the bag exactly as the bag's hotbar row does.
 *
 * Run by `verify-inventory-screen.ts` once per platform, in a child process:
 * the platform is decided once, when the game's modules load.
 *
 *   npx tsx scripts/inventoryScreenScene.ts --platform=desktop|phone
 */

import type { ItemId } from '../src/core/items/defs/ItemDefs.js';

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
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/input/InputManager.js');
const { getLevelDef } = await import('../src/levels/index.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { AchievementManager } = await import('../src/core/progression/AchievementManager.js');
const { presentationAwardId } = await import('../src/loot/rewardChest.js');
const { QUEST_SLOT_IDX } = await import('../src/core/items/defs/ItemDefs.js');
const { TutorialController } = await import('../src/systems/TutorialController.js');
const { MOUSE_POINTER_ID, PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { toCssRect } = await import('../src/ui/hud/HudSurface.js');
const { drinkRefusal } = await import('../src/ui/potionNotices.js');
const { intoxicationOf } = await import('../src/core/combat/Intoxication.js');
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
const SEISMIC_STOMP_HOTBAR_SLOT = 0;
const POTION_HOTBAR_SLOT = 1;
const HOODIE_TRY_HOTBAR_SLOT = 2;
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

function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
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
    if (!scene.arrivalLoadingOpen) return true;
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

/** Slot `index` of the HUD's own bar, as drawn last frame, or null when the HUD drew no bar. */
function hudHotbarRect(scene: Scene, index: number): Rect | null {
  const hudFrame = scene['hud'].frame;
  const rect = hudFrame?.geometry.hotbar.slots[index];
  return hudFrame === null || rect === undefined ? null : toCssRect(rect, hudFrame.uiScale);
}

function hudHotbarCell(scene: Scene, index: number): Point {
  const rect = hudHotbarRect(scene, index);
  if (rect === null) throw new Error(`the HUD drew no hotbar slot ${index}`);
  return centre(rect);
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
  check(
    scene['awards'].unlock('human', 'first_kill'),
    'the first tutorial kill pays the tutorial kit',
  );
  // The reward screen is its own gate's subject; here the chest is taken as
  // read, as closing it would, before the bag step it leads into.
  check(
    presentationAwardId(scene['humanAchievements'].takePresentation()) === 'first_kill',
    'and queues its chest for the reward screen',
  );
  tutorial.onHumanRewardDialogDismissed();
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

  await drag(
    scene,
    bagCell(scene, 'seismic_stomp_tome'),
    hotbarCell(scene, SEISMIC_STOMP_HOTBAR_SLOT),
  );
  tick(scene);
  check(
    human.inventory.actionBar.slots[SEISMIC_STOMP_HOTBAR_SLOT]?.id === 'seismic_stomp_tome',
    'the Seismic Stomp tome is dragged to hotbar slot 1',
  );
  check(tutorial.tutorialDragItemId === 'health_potion', 'and the tutorial asks for the potions');

  await drag(scene, bagCell(scene, 'health_potion'), hotbarCell(scene, POTION_HOTBAR_SLOT));
  tick(scene);
  check(
    human.inventory.actionBar.slots[POTION_HOTBAR_SLOT]?.id === 'health_potion',
    'the potions are dragged to hotbar slot 2',
  );
  check(
    tutorial.tutorialBlockedDragItemId === 'lucky_hoodie',
    'and the tutorial asks for the hoodie to be put on',
  );

  const hoodieSlot = human.inventory.bag.slots.findIndex((item) => item?.id === 'lucky_hoodie');
  await drag(scene, bagCell(scene, 'lucky_hoodie'), hotbarCell(scene, HOODIE_TRY_HOTBAR_SLOT));
  const hintTimer: unknown = Reflect.get(tutorial, '_hoodieDragHintTimer');
  tick(scene, 1);
  check(
    human.inventory.actionBar.slots[HOODIE_TRY_HOTBAR_SLOT] === null &&
      human.inventory.bag.slots[hoodieSlot]?.id === 'lucky_hoodie',
    'a drag of the hoodie to the hotbar moves nothing',
  );
  check(typeof hintTimer === 'number' && hintTimer > 0, 'and raises the tutorial’s hint about it');

  await openContextMenu(scene, bagCell(scene, 'lucky_hoodie'));
  check(
    screen.menu?.kind === 'item' && screen.menu.target.item.id === 'lucky_hoodie',
    onPhone
      ? 'a finger held on the hoodie opens its context menu'
      : 'a right-click on the hoodie opens its context menu',
  );
  const equip = regionPoint(scene, (id) => id === 'inventory/item-menu/equip');
  check(equip !== null, 'which offers Equip');
  if (equip !== null) tap(scene, equip);
  check(
    human.inventory.equipment.getEquippedId('Torso:Jacket') === 'lucky_hoodie',
    'Equip puts the hoodie on through the scene',
  );
  tick(scene);
  check(tutorial.state === 'HUMAN_EQUIPPED_SEISMIC_STOMP', 'and the tutorial moves on');
  check(!screen.isOpen && !menus.pauseScreen.isOpen, 'closing the bag behind it');
}

// ── A plain dungeon floor ──────────────────────────────────────────────────

section('a dungeon floor');
{
  // Already earned, so arriving pays no chest whose reward screen would sit over the bag.
  const humanAchievements = new AchievementManager();
  const catAchievements = new AchievementManager();
  humanAchievements.recordUnlock('down_the_hatch');
  catAchievements.recordUnlock('down_the_hatch');
  const scene = new DungeonScene(getLevelDef('level1'), new InputManager(), sceneManager, {
    worldSeed: WORLD_SEED,
    skipIntro: true,
    humanAchievements,
    catAchievements,
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
      human.inventory.moveHotbarToBag(index);
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

  section('a drink only the cat may have');
  {
    const cat = scene['cat'];
    const drinks = 'catnip_tuna_water' satisfies ItemId;
    human.inventory.addItem(drinks, 1);
    const humanBottles = human.inventory.countOf(drinks);
    check(
      !menus.drinkPotion(human, drinks, null),
      'the human is refused the bottle he reaches for',
    );
    check(human.inventory.countOf(drinks) === humanBottles, 'and keeps it unopened');
    check(
      menus.toasts.shown.some((toast) => toast.text === drinkRefusal('cat')),
      'with a toast saying whose it is',
    );
    cat.inventory.addItem(drinks, 1);
    cat.hp = Math.max(1, cat.maxHp - WOUND_HP);
    const catBottles = cat.inventory.countOf(drinks);
    check(menus.drinkPotion(cat, drinks, null), 'the cat drinks it');
    check(cat.inventory.countOf(drinks) === catBottles - 1, 'spending one bottle');
    check(cat.hasStatus('catnip_buzz'), 'and comes away buzzed');
    check(intoxicationOf(cat) === 'catnip_buzz', 'which is how she sways and swings');
  }

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

  section('the HUD’s hotbar beside the bag opened from the pause menu');
  tick(scene, 1);
  human.inventory.addItem('speed_fizz', 1);
  human.inventory.addItem('hearthguard_boots', 1);
  const bar = human.inventory.actionBar.slots;
  const freeSlots = bar.flatMap((item, index) =>
    item === null && index !== QUEST_SLOT_IDX ? [index] : [],
  );
  const freeSlotsNeeded = 3;
  const enoughFreeSlots = freeSlots.length >= freeSlotsNeeded;
  const [first, second, third] = freeSlots;
  scene['togglePause']();
  tick(scene, 1);
  const inventoryEntry = regionPoint(
    scene,
    (id, surfaceId) => surfaceId === PAUSE_SURFACE_ID && id.endsWith('/inventory'),
  );
  if (inventoryEntry !== null) tap(scene, inventoryEntry);
  tick(scene, 1);
  check(screen.isOpen && screen.tab === 'bag', 'the pause menu’s Inventory entry opens the bag');
  const panelFrame = screen.geometry.frame;
  const hudSlot = hudHotbarRect(scene, first);
  const hudBarShows =
    panelFrame !== null &&
    hudSlot !== null &&
    !contains(toCssRect(panelFrame, scene.ui.uiScale), centre(hudSlot));
  if (!onPhone) check(hudBarShows, 'the HUD’s hotbar shows beside the bag on a desktop');
  check(enoughFreeSlots, 'the hotbar has room for the HUD hotbar drags');
  if (hudBarShows && enoughFreeSlots) {
    const fizzInBag = (): boolean =>
      human.inventory.bag.slots.some((item) => item?.id === 'speed_fizz');
    await drag(scene, bagCell(scene, 'speed_fizz'), hudHotbarCell(scene, first));
    check(bar[first]?.id === 'speed_fizz', 'a drag from the bag onto the HUD’s hotbar lands');
    await drag(scene, hudHotbarCell(scene, first), hudHotbarCell(scene, second));
    check(
      bar[second]?.id === 'speed_fizz' && bar[first] === null,
      'a drag along the HUD’s hotbar rearranges it',
    );
    await drag(scene, hudHotbarCell(scene, second), hotbarCell(scene, third));
    check(
      bar[third]?.id === 'speed_fizz' && bar[second] === null,
      'a drag from the HUD’s hotbar onto the bag’s hotbar row moves it there',
    );
    await drag(scene, hotbarCell(scene, third), hudHotbarCell(scene, first));
    check(
      bar[first]?.id === 'speed_fizz' && bar[third] === null,
      'and back from the row onto the HUD’s hotbar',
    );
    tap(scene, hudHotbarCell(scene, first));
    check(
      screen.selection?.source === 'hotbar' && screen.selection.slotIdx === first,
      'a tap on the HUD’s hotbar selects the stack as the row does',
    );
    check(bar[first]?.id === 'speed_fizz', 'rather than using it');
    await drag(scene, bagCell(scene, 'hearthguard_boots'), hudHotbarCell(scene, second));
    check(
      bar[second] === null && screen.notice?.id === 'hearthguard_boots',
      'gear refuses the HUD’s hotbar and says why, as it refuses the row',
    );
    const grid = screen.geometry.grid;
    if (grid !== null) {
      await drag(scene, hudHotbarCell(scene, first), centre(toCssRect(grid, scene.ui.uiScale)));
    }
    check(bar[first] === null && fizzInBag(), 'a drag from the HUD’s hotbar onto the grid bags it');
  }
  screen.close();
  tick(scene, 1);
}

console.log(
  `\n${onPhone ? 'phone' : 'desktop'} scene: ${passes} passed, ${failures} failed` +
    (failures === 0 ? '.' : ' — FAILED.'),
);
process.exit(failures === 0 ? 0 : 1);
