/**
 * The dungeon half of `verify:ui-input`: the real `DungeonScene`, headless on
 * one platform, driven through its `UiRoot` with the pointer gestures the
 * browser would send. It repeats the known click-through cases against the
 * scene's real surfaces:
 *
 *  - a stairwell or building menu up over a HUD button: the press reaches the
 *    menu, never the button drawn beneath its backdrop;
 *  - the bag's context menu does not survive under the pause menu;
 *  - a level-up raised while a finger rests on the hotbar does not let the
 *    release use the slot or answer the dialog.
 *
 * Each case has a control that runs the same input with the fix taken away
 * (the menu mounted without its block, the overlay not raised) and checks the
 * click-through it guards against really happens there, so a probe that has
 * stopped seeing the bug fails instead of passing quietly.
 *
 * It also checks the runtime half of `verify:menus`: whichever menu is on top
 * declares the keyboard focus ring the keyboard then drives.
 *
 * Run by `verify-ui-input.ts` once per platform, in a child process: the
 * platform is decided once, when the game's modules load.
 *
 *   npx tsx scripts/uiInputDungeon.ts --platform=desktop|phone
 */

import type { Surface } from '../src/ui/core/UiRoot.js';
import type { ShimKeyInit } from './browserShim.js';

export {};

const platformArg = process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1];
const onPhone = platformArg === 'phone';

const PHONE = { width: 390, height: 844, devicePixelRatio: 1 } as const;
const DESKTOP = { width: 1280, height: 800, devicePixelRatio: 1 } as const;
const VIEWPORT = onPhone ? PHONE : DESKTOP;

Object.defineProperty(globalThis, 'navigator', {
  value: onPhone
    ? { maxTouchPoints: 1, userAgent: 'iPhone' }
    : { maxTouchPoints: 0, userAgent: 'Desktop' },
  configurable: true,
});

const { installBrowserShim, ShimEvent } = await import('./browserShim.js');
const browser = installBrowserShim(VIEWPORT);
const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { gameContext } = await import('./nodeGameContext.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { ITEM_DEF } = await import('../src/core/ItemDefs.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { LoadingOverlay } = await import('../src/ui/LoadingScreen.js');
const { MOUSE_POINTER_ID, PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { signLine } = await import('../src/dialog/scripts/crawlerSigns.js');
const { toCssRect } = await import('../src/ui/hud/HudSurface.js');
const { LONG_PRESS_MS } = await import('../src/ui/screens/inventory/InventoryScreen.js');
const { ACHIEVEMENT_DEFS } = await import('../src/core/AchievementManager.js');

type Scene = InstanceType<typeof DungeonScene>;
type DockId = Parameters<Scene['hud']['cssDockRect']>[0];
type GestureKind = 'down' | 'move' | 'up' | 'cancel';
interface Point {
  readonly x: number;
  readonly y: number;
}
interface Rect extends Point {
  readonly w: number;
  readonly h: number;
}

/** More frames than the town's arrival screen ever needs to finish its work. */
const MAX_ARRIVAL_FRAMES = 3000;
const SECONDARY_BUTTON = 2;
const FINGER_ID = 1;
const POTION_COUNT = 3;
const HOTBAR_LAST_SLOT = 7;
/** Long enough that the failed banner is still up for every press a case makes. */
const BANNER_FRAMES = 600;
/** Taken off the human so a potion has something to heal. */
const WOUND_HP = 5;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n── ${onPhone ? 'phone' : 'desktop'} dungeon: ${title}`);
}

function centre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

await loadSprites('src/images/');
setViewportSize(VIEWPORT.width, VIEWPORT.height);
const ctx = gameContext(VIEWPORT.width, VIEWPORT.height);

const pointerSource = onPhone ? 'touch' : 'mouse';
const pointerId = onPhone ? FINGER_ID : MOUSE_POINTER_ID;
let clock = 0;

/** One gesture through the scene's stack, in canvas CSS pixels, as `PointerInput` would send it. */
function send(
  scene: Scene,
  kind: GestureKind,
  at: Point,
  button: number = PRIMARY_BUTTON,
  id: number = pointerId,
): void {
  clock += 1;
  const scale = scene.ui.uiScale;
  scene.ui.pointer({
    kind,
    pointerId: id,
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

function tap(scene: Scene, at: Point, button: number = PRIMARY_BUTTON): void {
  send(scene, 'down', at, button);
  send(scene, 'up', at, button);
}

function frame(scene: Scene): void {
  scene.render(ctx);
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

/** Pause, bag and follower menu all shut: the HUD buttons under test reach one of them. */
function hudUntouched(scene: Scene): boolean {
  const menus = scene['menus'];
  return (
    !menus.pauseScreen.isOpen && !menus.inventoryScreen.isOpen && !scene['followerMenu'].isOpen
  );
}

function closeEverything(scene: Scene): void {
  const menus = scene['menus'];
  menus.pauseScreen.close();
  menus.closePanels();
  scene['followerMenu'].close();
  scene['building']?.closeMenu();
  scene['stairwell'].closeMenu();
  frame(scene);
}

/** A dock button's centre as the HUD last drew it, in CSS pixels, or null while it is not shown. */
function dockPoint(scene: Scene, id: DockId): Point | null {
  const rect = scene['hud'].cssDockRect(id);
  return rect === null ? null : centre(rect);
}

function requireDockPoint(scene: Scene, id: DockId): Point {
  const point = dockPoint(scene, id);
  if (point === null) throw new Error(`the HUD drew no ${id} button`);
  return point;
}

/** The dock buttons whose action {@link hudUntouched} sees. */
const WATCHED_DOCK_BUTTONS: readonly DockId[] = ['pause', 'bag', 'follower', 'journal'];

/** HUD buttons a press could be aimed at, by name, where they stand this frame. */
function hudButtons(scene: Scene): ReadonlyArray<{ name: string; at: Point }> {
  const drawn = scene['hud'].frame;
  if (drawn === null) throw new Error('the HUD has not drawn a frame');
  return WATCHED_DOCK_BUTTONS.flatMap((id) => {
    const rect = drawn.dock.get(id);
    return rect === undefined ? [] : [{ name: id, at: centre(toCssRect(rect, drawn.uiScale)) }];
  });
}

// ── The town ───────────────────────────────────────────────────────────────

const town = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
const sceneManager = new SceneManager();
const street = new DungeonScene(level3, new InputManager(), sceneManager, {
  existingMap: town,
  worldSeed: WORLD_SEED,
  skipIntro: true,
});
sceneManager.replace(street);
check(await settleArrival(street), "the town's arrival screen finishes");
frame(street);

// ── A menu over the HUD ────────────────────────────────────────────────────

/**
 * Opens a menu with `open`, then presses every HUD button under it. Returns
 * the buttons that answered.
 */
function hudButtonsAnsweringUnder(scene: Scene, open: () => void): string[] {
  const answered: string[] = [];
  for (const button of hudButtons(scene)) {
    closeEverything(scene);
    open();
    frame(scene);
    tap(scene, button.at);
    frame(scene);
    if (!hudUntouched(scene)) answered.push(button.name);
  }
  closeEverything(scene);
  return answered;
}

function openBuildingMenu(scene: Scene): void {
  const building = scene['building'];
  if (building === null) throw new Error('the town has no building system');
  const door = scene['gameMap'].buildingEntries.find((entry) => entry.type === 'store');
  if (door === undefined) throw new Error('the town has no General Store');
  const active = scene['active']();
  active.x = door.doorTile.x * TILE_SIZE;
  active.y = door.doorTile.y * TILE_SIZE;
  building['onDoor'] = false;
  building.detect(active);
}

/** The focusable controls a surface registered on the last frame: the ring Tab walks. */
function focusableIds(scene: Scene, surfaceId: string): string[] {
  return scene.ui
    .regions()
    .filter((region) => region.surfaceId === surfaceId && region.focusable)
    .map((region) => region.id);
}

function openStairwellMenu(scene: Scene): void {
  scene['stairwell']['_menuOpen'] = true;
}

/**
 * Swaps a mounted surface for one that is open whenever the menu is but
 * registers nothing, runs `body`, and puts the real one back. The menu's
 * own surface cannot stand in: its scrim is the block under test.
 */
function withoutBlock<T>(
  scene: Scene,
  surfaceId: string,
  isMenuOpen: () => boolean,
  body: () => T,
): T {
  const mounted = scene.ui['mounted'].find((entry) => entry.surface.id === surfaceId)?.surface;
  if (mounted === undefined) throw new Error(`no surface "${surfaceId}" is mounted`);
  scene.ui.unmount(mounted);
  const leaky: Surface = {
    id: `${surfaceId}-unblocked`,
    band: 'world',
    isOpen: isMenuOpen,
    render: () => undefined,
    haltsWorld: false,
  };
  scene.ui.mount(leaky);
  try {
    return body();
  } finally {
    scene.ui.unmount(leaky);
    scene.ui.mount(mounted);
  }
}

section('a building menu over the HUD takes every press aimed at a button beneath it');
{
  const building = street['building'];
  openBuildingMenu(street);
  check(building?.menuOpen === true, 'standing on the General Store door opens its menu');
  frame(street);
  check(street.ui.focusSurfaceId() === 'building-entry', 'the menu is the top surface');
  const ring = focusableIds(street, 'building-entry');
  check(
    ring.length > 0,
    `and its controls are the focus ring the keyboard drives (${ring.join(', ') || 'none'})`,
  );
  const buttons = hudButtons(street).map((button) => button.name);
  check(buttons.length >= 2, `there are HUD buttons to aim at (${buttons.join(', ')})`);
  const answered = hudButtonsAnsweringUnder(street, () => openBuildingMenu(street));
  check(
    answered.length === 0,
    `no HUD button answers a press under the menu (answered: ${answered.join(', ') || 'none'})`,
  );
  const leaked = withoutBlock(
    street,
    'building-entry',
    () => building?.menuOpen === true,
    () => hudButtonsAnsweringUnder(street, () => openBuildingMenu(street)),
  );
  check(
    leaked.length > 0,
    `control: with the menu mounted without its block, the same presses reach the HUD (${leaked.join(', ') || 'none'})`,
  );
}

section('a stairwell menu over the HUD takes every press aimed at a button beneath it');
{
  const stairwell = street['stairwell'];
  const answered = hudButtonsAnsweringUnder(street, () => openStairwellMenu(street));
  check(
    answered.length === 0,
    `no HUD button answers a press under the menu (answered: ${answered.join(', ') || 'none'})`,
  );
  const leaked = withoutBlock(
    street,
    'stairwell',
    () => stairwell.menuOpen,
    () => hudButtonsAnsweringUnder(street, () => openStairwellMenu(street)),
  );
  check(
    leaked.length > 0,
    `control: with the menu mounted without its block, the same presses reach the HUD (${leaked.join(', ') || 'none'})`,
  );
}

section('whichever menu is on top declares the focus ring the keyboard drives');
{
  closeEverything(street);
  check(street.ui.focusSurfaceId() === null, 'with no menu up, no surface holds the keyboard');
  const menus: ReadonlyArray<{ id: string; open: () => void }> = [
    { id: 'stairwell', open: () => openStairwellMenu(street) },
    { id: 'notice-board', open: () => street['openNoticeBoard']() },
    { id: 'building-entry', open: () => openBuildingMenu(street) },
  ];
  for (const menu of menus) {
    closeEverything(street);
    menu.open();
    frame(street);
    const ring = focusableIds(street, menu.id);
    check(
      street.ui.focusSurfaceId() === menu.id && ring.length > 0,
      `${menu.id} on top holds the keyboard with its own controls as the ring (top: ${street.ui.focusSurfaceId() ?? 'none'}, ring: ${ring.join(', ') || 'none'})`,
    );
  }
  street['noticeBoard']?.close();
  closeEverything(street);
}

// ── The bag's context menu and the pause menu ──────────────────────────────

/** Held past the long press, so a frame drawn after it sees the hold as long enough. */
const LONG_PRESS_SLACK_MS = 50;
const INVENTORY_CLOSE_REGION_ID = 'inventory/close';

/** A HUD hotbar slot's centre as the HUD last drew it, in CSS pixels. */
function hudHotbarPoint(scene: Scene, index: number): Point {
  const hudFrame = scene['hud'].frame;
  const slot = hudFrame?.geometry.hotbar.slots[index];
  if (hudFrame === null || slot === undefined) throw new Error('the HUD hotbar is not drawn');
  return centre(toCssRect(slot, hudFrame.uiScale));
}

/** Puts potions on the hotbar and returns where their slot stands. */
function stockHotbar(scene: Scene): Point {
  const human = scene['human'];
  if (!human.isActive) scene['triggerSwitchCharacter'](true);
  human.inventory.addItem('health_potion', POTION_COUNT);
  const slot = human.inventory.actionBar.slots.findIndex((item) => item?.id === 'health_potion');
  if (slot < 0) throw new Error('the potions did not land on the hotbar');
  frame(scene);
  return hudHotbarPoint(scene, slot);
}

/** Opens the bag with an item in its first slot, and returns that slot's middle. */
function stockBag(scene: Scene): Point {
  const menus = scene['menus'];
  const inventory = menus.inventoryPlayer().inventory;
  inventory.addItem('scroll_of_confusing_fog', 1);
  const index = inventory.bag.slots.findIndex((item) => item !== null);
  if (index < 0) throw new Error('the bag stayed empty');
  if (!menus.inventoryScreen.isOpen) menus.toggleInventory();
  frame(scene);
  const rect = menus.inventoryScreen.geometry.bagCells.get(index);
  if (rect === undefined) throw new Error('the bag slot is not on screen');
  return centre(toCssRect(rect, scene.ui.uiScale));
}

/** A finger held still on a slot, or a right-click on it, opens its menu. */
async function openSlotContextMenu(scene: Scene, slot: Point): Promise<void> {
  if (onPhone) {
    send(scene, 'down', slot);
    frame(scene);
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + LONG_PRESS_SLACK_MS));
    frame(scene);
    send(scene, 'up', slot);
  } else {
    tap(scene, slot, SECONDARY_BUTTON);
  }
}

section("the bag's context menu does not survive under the pause menu");
{
  closeEverything(street);
  const hotbarSlot = stockHotbar(street);
  const menus = street['menus'];
  tap(street, hotbarSlot, SECONDARY_BUTTON);
  check(
    !menus.inventoryScreen.isOpen && menus.inventoryScreen.menu === null,
    'a right-click on a HUD hotbar slot opens no menu: arranging the bar is the inventory’s',
  );
  const slot = stockBag(street);
  await openSlotContextMenu(street, slot);
  check(
    menus.inventoryScreen.menu?.kind === 'item',
    onPhone
      ? 'a finger held on a bag slot opens its context menu'
      : 'a right-click on a bag slot opens its context menu',
  );
  frame(street);
  check(street.ui.isOpen('inventory'), 'inside the inventory surface');

  street['togglePause']();
  check(menus.pauseScreen.isOpen, 'the pause key opens the pause menu over it');
  check(
    !menus.inventoryScreen.isOpen && menus.inventoryScreen.menu === null,
    'and the inventory and its context menu close with it',
  );

  closeEverything(street);
  await openSlotContextMenu(street, stockBag(street));
  frame(street);
  street['openQuestJournal']();
  frame(street);
  check(
    menus.inventoryScreen.menu === null,
    'the Journal’s pause menu leaves no context menu up by its first frame',
  );
  check(street.ui.focusSurfaceId() === 'pause', 'leaving the pause menu on top');
  const pauseRing = street.ui
    .regions()
    .filter((region) => region.surfaceId === 'pause' && region.focusable).length;
  check(
    pauseRing > 0 && street.ui.key('Tab') === 'consumed',
    `whose controls are the focus ring the keyboard drives (ring: ${pauseRing})`,
  );
  closeEverything(street);
  check(menus.inventoryScreen.menu === null, 'closing the pause menu brings no context menu back');
}

// ── A level-up raised during a hotbar press ────────────────────────────────

function levelUp(scene: Scene): void {
  scene['menus'].levelUpDialog.enqueue({
    name: 'Click-through',
    newLevel: 2,
    perkDescription: null,
    renderIcon: () => undefined,
  });
}

if (onPhone) {
  section(
    'a hotbar slot fires as the finger lands, and a level-up raised before the release adds nothing',
  );
  closeEverything(street);
  const slot = stockHotbar(street);
  const menus = street['menus'];
  const human = street['human'];
  let drinks = 0;
  const drinkPotion = menus.drinkPotion.bind(menus);
  menus.drinkPotion = (...args) => {
    drinks++;
    return drinkPotion(...args);
  };
  human.hp = Math.max(1, human.maxHp - WOUND_HP);

  tap(street, slot);
  frame(street);
  check(drinks === 1, `control: a tap on the potion with nothing raised uses it (uses: ${drinks})`);

  drinks = 0;
  send(street, 'down', slot);
  check(drinks === 1, `the press uses the slot at once (uses: ${drinks})`);
  levelUp(street);
  frame(street);
  check(menus.levelUpDialog.isShowing, 'a level-up comes up while the finger is down');
  send(street, 'up', slot);
  frame(street);
  check(drinks === 1, `the release uses nothing more (uses: ${drinks})`);
  check(menus.levelUpDialog.isShowing, 'and answers nothing on the dialog either');
  check(menus.inventoryScreen.menu === null, 'nor leaves a context menu behind it');
}

// ── Dynamite on the hotbar ─────────────────────────────────────────────────

section('a press on the dynamite slot lights the stick, and its release throws it');
{
  clearAwards(street);
  closeEverything(street);
  const human = street['human'];
  if (!human.isActive) street['triggerSwitchCharacter'](true);
  const index = 0;
  human.inventory.actionBar.slots[index] = { ...ITEM_DEF.goblin_dynamite, quantity: 1 };
  frame(street);
  const dynamite = street['destruction'].dynamite;
  const slot = hudHotbarPoint(street, index);
  let thrown = 0;
  const unsubscribe = street['bus'].on('dynamiteUsed', () => thrown++);
  send(street, 'down', slot);
  check(
    dynamite.isCharging && dynamite.chargingHotbarIdx === index,
    'the press lights it and starts the charge',
  );
  send(street, 'up', slot);
  check(!dynamite.isCharging && thrown === 1, `the release throws it (throws: ${thrown})`);
  unsubscribe();
  closeEverything(street);
}

// ── Review fixes ───────────────────────────────────────────────────────────

/** Takes every award card down, so the next case starts on an open floor. */
function clearAwards(scene: Scene): void {
  const { levelUpDialog, rewardGrantedDialog } = scene['menus'];
  levelUpDialog['queue'].length = 0;
  levelUpDialog['current'] = null;
  levelUpDialog['phase'] = 'idle';
  rewardGrantedDialog['queue'].length = 0;
  rewardGrantedDialog['current'] = null;
  rewardGrantedDialog['phase'] = 'idle';
  frame(scene);
}

/** Open floor sits one part in this many down the screen: clear of both the HUD and the top bar. */
const OPEN_FLOOR_HEIGHT_DIVISOR = 3;
const OPEN_FLOOR: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / OPEN_FLOOR_HEIGHT_DIVISOR };
const SECOND_FINGER_ID = 2;
/** How far a second finger slides across the hotbar: past every drag threshold. */
const SECOND_FINGER_SLIDE_PX = 80;
/** A lane tap's slide: past the default tap slop, within a menu tap's reach. */
const LANE_TAP_SLIDE_PX = 15;

if (onPhone) {
  section('a second finger on the HUD neither moves nor ends the first one’s press');
  clearAwards(street);
  closeEverything(street);
  const slot = stockHotbar(street);
  const menus = street['menus'];
  const human = street['human'];
  human.hp = Math.max(1, human.maxHp - WOUND_HP);
  let drinks = 0;
  const drinkPotion = menus.drinkPotion.bind(menus);
  menus.drinkPotion = (...args) => {
    drinks++;
    return drinkPotion(...args);
  };
  const otherSlot = hudHotbarPoint(street, HOTBAR_LAST_SLOT);
  send(street, 'down', slot);
  send(street, 'down', otherSlot, PRIMARY_BUTTON, SECOND_FINGER_ID);
  send(
    street,
    'move',
    { x: otherSlot.x - SECOND_FINGER_SLIDE_PX, y: otherSlot.y },
    PRIMARY_BUTTON,
    SECOND_FINGER_ID,
  );
  send(
    street,
    'up',
    { x: otherSlot.x - SECOND_FINGER_SLIDE_PX, y: otherSlot.y },
    PRIMARY_BUTTON,
    SECOND_FINGER_ID,
  );
  check(
    drinks === 1,
    `the first finger's press used its slot, the second finger nothing (uses: ${drinks})`,
  );
  send(street, 'up', slot);
  frame(street);
  check(drinks === 1, `the first finger's release uses nothing more (uses: ${drinks})`);

  section('a phone HUD button answers on the release, once');
  closeEverything(street);
  let bagToggles = 0;
  const toggleBag = street['toggleBagFromHud'].bind(street);
  street['toggleBagFromHud'] = () => {
    bagToggles++;
    toggleBag();
  };
  const bagButton = requireDockPoint(street, 'bag');
  send(street, 'down', bagButton);
  check(
    !menus.inventoryScreen.isOpen && bagToggles === 0,
    `the bag button does nothing as the finger lands (toggles: ${bagToggles})`,
  );
  send(street, 'up', bagButton);
  frame(street);
  check(
    menus.inventoryScreen.isOpen && bagToggles === 1,
    `and opens the bag on the release (toggles: ${bagToggles})`,
  );
  tap(street, bagButton);
  frame(street);
  check(
    menus.inventoryScreen.isOpen && bagToggles === 1,
    `the open inventory fills the phone, so a tap where the button was lands on it (toggles: ${bagToggles})`,
  );
  const closeRegion = street.ui.regions().find((region) => region.id === INVENTORY_CLOSE_REGION_ID);
  if (closeRegion === undefined) throw new Error('the inventory drew no close button');
  tap(street, centre(toCssRect(closeRegion.rect, street.ui.uiScale)));
  frame(street);
  check(!menus.inventoryScreen.isOpen, 'and its ✕ closes it');
  closeEverything(street);
}

section('Escape on a conversation goes to its speaker only where it always did');
{
  clearAwards(street);
  closeEverything(street);
  const conversation = street['conversation'];
  const stranger = conversation.open({
    lines: [signLine({ direction: 'North' })],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: false,
    anchor: null,
    locksKeyboard: false,
  });
  frame(street);
  check(conversation.isActive(stranger), 'a conversation no speaker in the chain owns is up');
  check(
    street.ui.key('Escape') === 'gameplay',
    'Escape passes it by, to the pause key, which closes it for the menu',
  );
  conversation.close();
  const active = street['active']();
  const citizen = street['townLife']?.people.find(
    (person) => street['townLife']?.findTalkTarget(person.x + TILE_SIZE, person.y) === person,
  );
  if (citizen === undefined) throw new Error('no citizen stands free to talk to');
  active.x = citizen.x + TILE_SIZE;
  active.y = citizen.y;
  check(street['tryTalkToCitizen'](active), 'a citizen in reach starts talking');
  frame(street);
  check(street.ui.key('Escape') === 'consumed', "Escape is the citizen's: it closes the box");
  check(!conversation.isOpen, 'and the box is gone');

  section('an edge pixel of a floating box is the box’s, never the world’s');
  check(street['tryTalkToCitizen'](active), 'the citizen talks again');
  frame(street);
  const boxRects = conversation.hitRects();
  if (boxRects.length === 0) throw new Error('the box drew nowhere');
  const box = boxRects[0];
  let worldTaps = 0;
  const tapWorld = street['tapWorld'].bind(street);
  street['tapWorld'] = (x, y, timeStamp) => {
    worldTaps++;
    tapWorld(x, y, timeStamp);
  };
  let boxClicks = 0;
  const handleClick = conversation.handleClick.bind(conversation);
  conversation.handleClick = (x, y) => {
    boxClicks++;
    return handleClick(x, y);
  };
  tap(street, { x: box.x + box.w, y: box.y + box.h });
  check(
    boxClicks === 1 && worldTaps === 0,
    `a tap on its bottom-right corner reaches the box (box: ${boxClicks}, world: ${worldTaps})`,
  );
  conversation.close();
  frame(street);
}

section('the defend quest’s failed banner');
{
  closeEverything(street);
  const defend = street['defendQuest'];
  const banner = (): void => {
    defend['failOverlayTimer'] = BANNER_FRAMES;
    frame(street);
  };
  banner();
  tap(street, requireDockPoint(street, onPhone ? 'bag' : 'pause'));
  frame(street);
  if (onPhone) {
    check(
      street['menus'].inventoryScreen.isOpen && defend.isOutcomeOverlayShowing,
      'on a phone the HUD stays live under it: the bag opens and the banner stays',
    );
    closeEverything(street);
    tap(street, OPEN_FLOOR);
    check(!defend.isOutcomeOverlayShowing, 'and a tap on the world dismisses it');
  } else {
    check(
      !street['menus'].pauseScreen.isOpen && !defend.isOutcomeOverlayShowing,
      'a click anywhere, the pause button included, only dismisses it',
    );
  }
  closeEverything(street);
}

section('a Keyboard Hero lane tap that slides a little still counts');
{
  closeEverything(street);
  const spider = street['spiderQuest'];
  spider['phase'] = 'hacking';
  const laneTaps: Array<{ lane: number; timeStamp: number | undefined }> = [];
  spider.tapKeyboardHeroLane = (lane, timeStamp) => {
    laneTaps.push({ lane, timeStamp });
  };
  frame(street);
  check(street.ui.isOpen('keyboard-hero'), 'the song owns the screen');
  const laneRegion = street.ui.regions().find((region) => region.id === 'keyboard-hero/lane-1');
  check(laneRegion !== undefined, 'the board registers its lanes as tap regions');
  if (laneRegion !== undefined) {
    const scale = street.ui.uiScale;
    const laneCentre = centre(laneRegion.rect);
    const start = { x: laneCentre.x * scale, y: laneCentre.y * scale };
    const end = { x: start.x, y: start.y + LANE_TAP_SLIDE_PX };
    send(street, 'down', start);
    send(street, 'move', end);
    send(street, 'up', end);
    const releaseStamp = clock;
    check(
      laneTaps.length === 1 && laneTaps[0]?.lane === 1,
      `a tap that slid ${LANE_TAP_SLIDE_PX}px reaches the lane it was drawn on (${laneTaps.length})`,
    );
    check(
      laneTaps[0]?.timeStamp === releaseStamp,
      'and is scored by the release event’s own time stamp',
    );
  }
  spider['phase'] = 'inactive';
  frame(street);
}

// ── The achievement card ───────────────────────────────────────────────────

{
  section('the achievement card answers Space, Enter and the attack key');
  const achievementUI = street['achievementUI'];
  const achievements = street['humanAchievements'];
  /** Past the card's fade-in, after which OK answers. */
  const CARD_SETTLE_FRAMES = 30;
  const ACCEPT_KEYS = [' ', 'Enter'] as const;
  for (const key of ACCEPT_KEYS) {
    closeEverything(street);
    achievements.pendingNotifications.length = 0;
    achievements.pendingNotifications.push(ACHIEVEMENT_DEFS.first_blood);
    check(
      achievementUI.showUnread() && achievementUI.notifActive,
      `the card is up for ${JSON.stringify(key)}`,
    );
    frame(street);
    street.ui.key(key);
    check(
      achievementUI.notifActive,
      `${JSON.stringify(key)} before the fade-in does not dismiss it`,
    );
    for (let tick = 0; tick < CARD_SETTLE_FRAMES; tick++) achievementUI.tick();
    frame(street);
    const result = street.ui.key(key);
    check(
      result === 'consumed' && !achievementUI.notifActive,
      `${JSON.stringify(key)} presses OK once the card has faded in (${result})`,
    );
    frame(street);
  }
}

// ── Keys held across a menu opening ────────────────────────────────────────

{
  section('a key released after Shift or Cmd changed it is not held for good');
  closeEverything(street);
  let probeOpen = false;
  const pressesSeen: Array<{ key: string; predates: boolean }> = [];
  const probe: Surface = {
    id: 'held-key-probe',
    band: 'modal',
    haltsWorld: true,
    isOpen: () => probeOpen,
    render: () => undefined,
    onKey: (key, mods) => {
      pressesSeen.push({ key, predates: mods.predatesSurface === true });
      return true;
    },
  };
  street.ui.mount(probe);
  const keyEvent = (type: 'keydown' | 'keyup', key: string, init: ShimKeyInit): void => {
    clock += 1;
    browser.window.dispatch(new ShimEvent(type, key, clock, undefined, [], init));
  };
  keyEvent('keydown', 'a', { code: 'KeyA' });
  keyEvent('keyup', 'A', { code: 'KeyA', shiftKey: true });
  keyEvent('keydown', 'c', { code: 'KeyC', metaKey: true });
  keyEvent('keyup', 'Meta', { code: 'MetaLeft' });
  keyEvent('keydown', 'b', { code: 'KeyB' });
  probeOpen = true;
  frame(street);
  keyEvent('keydown', 'a', { code: 'KeyA' });
  keyEvent('keyup', 'a', { code: 'KeyA' });
  keyEvent('keydown', 'c', { code: 'KeyC' });
  keyEvent('keyup', 'c', { code: 'KeyC' });
  keyEvent('keydown', 'b', { code: 'KeyB', repeat: true });
  keyEvent('keyup', 'b', { code: 'KeyB' });
  const predated = (key: string) => pressesSeen.find((press) => press.key === key)?.predates;
  check(
    predated('a') === false,
    `a key lifted as Shift changed its letter is fresh (${predated('a')})`,
  );
  check(predated('c') === false, `a key lifted under Cmd is fresh (${predated('c')})`);
  check(
    predated('b') === true,
    `a key still held when the menu opened predates it (${predated('b')})`,
  );
  probeOpen = false;
  street.ui.unmount(probe);
  frame(street);
}

console.log(
  failures === 0
    ? `\nAll ${onPhone ? 'phone' : 'desktop'} dungeon input checks passed.`
    : `\n${failures} ${onPhone ? 'phone' : 'desktop'} dungeon check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
