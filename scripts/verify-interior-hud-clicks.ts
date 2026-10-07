#!/usr/bin/env tsx
/**
 * A press inside a building reaches whatever is drawn on top at that point,
 * and nothing beneath it.
 *
 * The interior draws its HUD (Build, the Journal, the pause button, the
 * hotbar) under every panel the room can raise, so a panel's button can sit
 * over one of them. On a 390x844 phone the General Store's panel spans the
 * width of the screen: a tap on its Buy column must not open the Construction
 * menu behind it, a tap on the bar under its scrim must not fire a hotbar
 * slot, a press that starts on the shop must not become a hotbar drag, and a
 * press whose shop closes before the finger lifts must not fire the slot it
 * lands on. Under a conversation that halts the room (one of Old Hilda's
 * beats) only the pause button and the skill-point badge stay live, and
 * Escape closes the beat rather than pausing; a beat that refuses Escape
 * leaves it to the pause menu. With nothing over it, every HUD control a
 * room offers (pause, bag, Build, the Journal, follower orders, the crawler
 * switch, the minimap, the skill-point badge and a hotbar slot) does its own
 * action and nothing else.
 *
 * Runs the real `BuildingInteriorScene` headless on a phone-sized viewport,
 * renders frames and presses through the scene's own `UiRoot`, the one path
 * a browser's mouse and touch events take.
 *
 *   npm run verify:interior-hud-clicks
 */

import type { InteriorJournalSource } from '../src/scenes/BuildingInteriorScene';
import type { Rect } from '../src/ui/core/geom';

// Before any game module loads: the platform is decided once, at import.
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 1, userAgent: 'iPhone' },
  configurable: true,
});

const PHONE = { width: 390, height: 844, devicePixelRatio: 1 } as const;
const { installBrowserShim } = await import('./browserShim.js');
const { settleArrival } = await import('./settleArrival.js');
installBrowserShim(PHONE);
const { gameContext } = await import('./nodeGameContext.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { platform } = await import('../src/core/Platform.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { snapPlayer } = await import('../src/core/PlayerSnapshot.js');
const { teachBoth } = await import('../src/core/CraftSkills.js');
const { createMarketStock } = await import('../src/systems/market/MarketStock.js');
const { createBriarHollowState } = await import('../src/core/briarHollowState.js');
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { PointerInput, PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { ITEM_DEF } = await import('../src/core/ItemDefs.js');
const { HILDA_COTTAGE_NAME } = await import('../src/systems/interiorStoryOwnership.js');
const { createAnchorQuestProgress } = await import('../src/core/AnchorQuestProgress.js');
const { speakerLines } = await import('../src/dialog/line.js');
const { toCssRect } = await import('../src/ui/hud/HudSurface.js');
const { liveHudLayout } = await import('../src/ui/hud/liveHudLayout.js');
const { createJournalProgress } = await import('../src/core/JournalProgress.js');

const WORLD_SEED = 1;
const TOUCH_ID = 1;
const POTIONS_ON_THE_BAR = 3;
/** Far enough to count as a drag rather than a tap, in CSS pixels. */
const DRAG_DISTANCE = 60;
/** The hotbar slot the checks aim at. */
const POTION_SLOT = 3;
/** Low enough that a potion always has something to heal. */
const WOUNDED_HP = 1;
/**
 * A landscape phone, where the shop's Close button sits on the hotbar: the
 * case a release on Close could fire the slot underneath it.
 */
const LANDSCAPE_PHONE = { width: 667, height: 375 } as const;
/** The shop's footer Close, drawn where the screen is tall enough for a footer. */
const SHOP_FOOTER_CLOSE_ID = 'shop/shop/leave';
/** The shop's header ✕, the way out on a screen too short for the footer. */
const SHOP_HEADER_CLOSE_ID = 'shop/shop/close';

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function centre(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Where the HUD lays a hotbar slot on this screen, in CSS pixels, whether or not it is drawn yet. */
function hudHotbarSlot(index: number): Rect {
  const live = liveHudLayout({ miniMapExpanded: false, build: false });
  const slot = live.geometry.hotbar.slots[index];
  if (slot === undefined) throw new Error(`the HUD lays out no hotbar slot ${index}`);
  return toCssRect(slot, live.uiScale);
}

function inside(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

check(platform.isMobile, 'the harness runs as a phone');
setViewportSize(PHONE.width, PHONE.height);
let ctx = gameContext(PHONE.width, PHONE.height);

const town = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});

function building(predicate: (entry: (typeof town.buildingEntries)[number]) => boolean) {
  const entry = town.buildingEntries.find(predicate);
  if (entry === undefined) throw new Error('the town is missing a building the checks need');
  return entry;
}

const human = new HumanPlayer(0, 0, TILE_SIZE);
const cat = new CatPlayer(1, 0, TILE_SIZE);
// The game always drives exactly one crawler; a snapshot with neither active
// leaves the room with no consistent leader for the switch to swap.
human.isActive = true;
teachBoth(human, cat, 'construction');
const village = createBriarHollowState();
village.unlocks.construction.push('trebuchet', 'snare');

type Interior = InstanceType<typeof BuildingInteriorScene>;
type DockId = Parameters<Interior['hud']['cssDockRect']>[0];

/** A building entered and past its arrival loading screen, ready to be driven. */
async function enter(
  entry: (typeof town.buildingEntries)[number],
  anchorProgress = createAnchorQuestProgress(),
  journal?: InteriorJournalSource,
): Promise<Interior> {
  const scene = new BuildingInteriorScene(
    entry,
    snapPlayer(human),
    snapPlayer(cat),
    level3.xpDiminishingTiers,
    level3.arrivalLoadingScreen,
    new InputManager(),
    new SceneManager(),
    () => undefined,
    createMarketStock(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    anchorProgress,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    village,
    journal,
  );
  if (!(await settleArrival(scene, ctx))) {
    throw new Error(`${entry.name}'s arrival screen never finished`);
  }
  return scene;
}

function hudFrame(scene: Interior) {
  const drawn = scene['hud'].frame;
  if (drawn === null) throw new Error('the HUD has not drawn a frame');
  return drawn;
}

/** Where a dock button stands as last drawn, in CSS pixels, or null while it is not shown. */
function dockPoint(scene: Interior, id: DockId): Point | null {
  const rect = scene['hud'].cssDockRect(id);
  return rect === null ? null : centre(rect);
}

function requireDockPoint(scene: Interior, id: DockId): Point {
  const point = dockPoint(scene, id);
  if (point === null) throw new Error(`the HUD drew no ${id} button`);
  return point;
}

/** Where the first skill-point badge stands as last drawn, in CSS pixels, or null with none drawn. */
function badgePoint(scene: Interior): Point | null {
  const badges = hudFrame(scene).skillBadges;
  return badges.length === 0 ? null : centre(toCssRect(badges[0], hudFrame(scene).uiScale));
}

/** The hotbar slot under a CSS-pixel point as the HUD last drew the bar, or -1. */
function hotbarSlotAt(scene: Interior, point: Point): number {
  const drawn = hudFrame(scene);
  return drawn.geometry.hotbar.slots.findIndex((slot) =>
    inside(point, toCssRect(slot, drawn.uiScale)),
  );
}

/** A scene with a press path, a frame and a wounded crawler holding potions on the bar. */
function rig(scene: InstanceType<typeof BuildingInteriorScene>) {
  const pointer = new PointerInput(
    (gesture) => scene.ui.pointer(gesture),
    () => scene.ui.uiScale,
  );
  const active = scene.pm.active();
  active.hp = WOUNDED_HP;
  active.inventory.actionBar.slots[POTION_SLOT] = {
    ...ITEM_DEF.health_potion,
    quantity: POTIONS_ON_THE_BAR,
  };
  return {
    frame: (): void => scene.render(ctx),
    tap: (point: Point): void => {
      pointer.touchStart(TOUCH_ID, point.x, point.y);
      pointer.touchEnd(TOUCH_ID, point.x, point.y);
    },
    click: (point: Point): void => {
      pointer.mouseDown(point.x, point.y, PRIMARY_BUTTON);
      pointer.mouseUp(point.x, point.y, PRIMARY_BUTTON);
    },
    pointer,
    wound: (): void => {
      active.hp = WOUNDED_HP;
    },
    potionsLeft: (): number => active.inventory.actionBar.slots[POTION_SLOT]?.quantity ?? 0,
    slotPoint: (): Point => centre(hudHotbarSlot(POTION_SLOT)),
  };
}

// ── The General Store ────────────────────────────────────────────────────────

const scene = await enter(building((entry) => entry.type === 'store'));
// Private collaborators, reached by name: the scene has no public way to open
// its counter, and the check is about what a press reaches, not how the panel
// was opened.
const shop = scene['shop'];
const menus = scene['menus'];
if (shop === null) throw new Error('the General Store built no shop');
const store = rig(scene);
const { frame, tap, click, pointer, potionsLeft } = store;
const slotPoint = store.slotPoint();

frame();
check(scene.ui.viewport.density === 'touch', 'the HUD is laid out for a finger');
const buildPoint = dockPoint(scene, 'build');
const pausePoint = requireDockPoint(scene, 'pause');
check(buildPoint !== null, 'the Build button is drawn once Construction is unlocked');

if (buildPoint !== null) {
  tap(buildPoint);
  check(menus.constructionMenu.isOpen, 'a tap on Build with nothing over it opens the menu');
  menus.constructionMenu.close();
  frame();

  // The shop is modal: its scrim covers every point the panel does not, and
  // a tap on the scrim closes the shop rather than reaching what is under it.
  shop.open();
  frame();
  tap(buildPoint);
  frame();
  check(
    !menus.constructionMenu.isOpen,
    'a tap on Build under the open shop does not open the Construction menu',
  );
  check(!shop.isOpen, 'the tap went to the shop, which it closed as a tap outside the panel');
  shop.close();
  frame();
}

console.log('\nThe hotbar under the shop');

tap(slotPoint);
frame();
check(
  potionsLeft() === POTIONS_ON_THE_BAR - 1,
  'a tap on a potion slot with nothing over it drinks it (the control for the checks below)',
);
const potionsBeforeShop = potionsLeft();
store.wound();

shop.open();
frame();
tap(slotPoint);
frame();
check(potionsLeft() === potionsBeforeShop, 'a tap on the hotbar under the shop fires no slot');
check(shop.isOpen, 'and the shop is still open');

pointer.touchStart(TOUCH_ID, slotPoint.x, slotPoint.y);
pointer.touchMove(TOUCH_ID, slotPoint.x, slotPoint.y - DRAG_DISTANCE);
check(
  menus.inventoryScreen.drag === null,
  'a drag that starts on the shop over the bar drags no item',
);
pointer.touchEnd(TOUCH_ID, slotPoint.x, slotPoint.y - DRAG_DISTANCE);
frame();
check(potionsLeft() === potionsBeforeShop, 'and its release fires no slot');

pointer.touchStart(TOUCH_ID, slotPoint.x, slotPoint.y);
shop.close();
frame();
pointer.touchEnd(TOUCH_ID, slotPoint.x, slotPoint.y);
frame();
check(
  potionsLeft() === potionsBeforeShop,
  'a press that began on the shop fires no slot when the shop closes before the release',
);

shop.open();
frame();
click(pausePoint);
frame();
check(!scene['pauseScreen'].isOpen, 'a click on the pause button under the shop does not pause');
check(!shop.isOpen, 'it closes the shop instead, as a tap outside the panel');
shop.open();
frame();

const stackOverShop = scene.ui.openSurfaceIds();
check(
  stackOverShop.indexOf('room-status') > stackOverShop.indexOf('shop'),
  `the room's status (toast, fight bars) draws over the shop (${stackOverShop.join(', ')})`,
);
scene['togglePause']();
frame();
check(
  !scene.ui.openSurfaceIds().includes('room-status'),
  'and under the pause menu, which takes the screen from the room',
);
scene['togglePause']();
frame();

console.log("\nThe shop's close control on a landscape phone, over the HUD");

setViewportSize(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
ctx = gameContext(LANDSCAPE_PHONE.width, LANDSCAPE_PHONE.height);
shop.open();
frame();
frame();
const shopCloseRegion =
  scene.ui.regions().find((region) => region.id === SHOP_FOOTER_CLOSE_ID) ??
  scene.ui.regions().find((region) => region.id === SHOP_HEADER_CLOSE_ID) ??
  null;
const closeCentre =
  shopCloseRegion === null ? null : centre(toCssRect(shopCloseRegion.rect, scene.ui.uiScale));
check(closeCentre !== null, "the shop's close control is on screen");
if (closeCentre !== null) {
  const slotUnderClose = hotbarSlotAt(scene, closeCentre);
  tap(closeCentre);
  frame();
  check(!shop.isOpen, "a tap on the shop's close control closes it");
  check(
    potionsLeft() === potionsBeforeShop,
    `and fires no hotbar slot${slotUnderClose === -1 ? '' : ` (slot ${slotUnderClose} lies beneath it)`}`,
  );
}
setViewportSize(PHONE.width, PHONE.height);
ctx = gameContext(PHONE.width, PHONE.height);

// ── Old Hilda's cottage ──────────────────────────────────────────────────────

console.log("\nUnder one of Old Hilda's beats, which halts the room");

const anchorProgress = createAnchorQuestProgress();
anchorProgress.status = 'active';
const cottage = await enter(
  building((entry) => entry.name === HILDA_COTTAGE_NAME),
  anchorProgress,
);
const hilda = rig(cottage);
function hildasRoom() {
  const room = cottage['anchorInterior'];
  if (room === null) throw new Error("Old Hilda's cottage has no questline system");
  return room;
}

function openHildasBeat(): void {
  check(hildasRoom().tryOpenDialog('old_hilda', cottage.pm.active()), 'her beat opens');
  hilda.frame();
  hilda.frame();
}

hilda.frame();
const cottagePause = requireDockPoint(cottage, 'pause');
openHildasBeat();
const hildaSlot = hilda.slotPoint();
hilda.tap(hildaSlot);
hilda.frame();
check(
  hilda.potionsLeft() === POTIONS_ON_THE_BAR,
  'a tap on the hotbar under her beat fires no slot',
);
check(cottage['conversation'].isOpen, 'and the beat is still open');

hilda.tap(cottagePause);
hilda.frame();
check(cottage['pauseScreen'].isOpen, 'the pause button still answers under her beat');
if (cottage['pauseScreen'].isOpen) cottage['togglePause']();
hilda.frame();

cottage.pm.human.unspentPoints = 1;
hilda.frame();
const cottageBadge = badgePoint(cottage);
check(cottageBadge !== null, 'a skill point to spend puts its badge on the unit frame');
if (cottageBadge !== null) hilda.tap(cottageBadge);
hilda.frame();
check(
  cottage['pauseScreen'].isOpen && cottage['pauseScreen'].currentSection === 'character',
  'and so does the skill-point badge, which opens the Spend page',
);
if (cottage['pauseScreen'].isOpen) cottage['togglePause']();
cottage.pm.human.unspentPoints = 0;
hilda.frame();

check(cottage.ui.key('Escape') === 'consumed', 'Escape is spent on her beat');
hilda.frame();
check(!cottage['conversation'].isOpen, 'and closes it');
check(!cottage['pauseScreen'].isOpen, 'without pausing');

const blockedLine = speakerLines('mordecai').line('A beat that must be read to the end.');
cottage['conversation'].open({
  lines: [blockedLine],
  reward: null,
  questRelated: true,
  ending: { kind: 'close', onClosed: () => undefined },
  dismiss: { kind: 'blocked' },
  haltsWorld: true,
  anchor: null,
  locksKeyboard: true,
});
hilda.frame();
check(
  cottage.ui.key('Escape') === 'gameplay',
  'Escape on a beat that refuses it passes to the pause menu',
);
check(cottage['conversation'].isOpen, 'and the beat stays open');
check(inside(hildaSlot, hudHotbarSlot(POTION_SLOT)), 'the slot point is on the bar');

// ── Every HUD control, with nothing over it ─────────────────────────────────

console.log('\nEach HUD control reaches its own action and nothing else');

const journal: InteriorJournalSource = { entries: () => [], progress: createJournalProgress() };
const room = await enter(
  building((entry) => entry.type === 'store'),
  createAnchorQuestProgress(),
  journal,
);
const roomRig = rig(room);
const roomPause = room['pauseScreen'];
const roomMenus = room['menus'];

/** Everything a HUD control can change, read off the room. */
function roomState() {
  const section = roomPause.currentSection;
  return {
    pause: roomPause.isOpen && section !== 'journal' && section !== 'character',
    journal: roomPause.isOpen && section === 'journal',
    spend: roomPause.isOpen && section === 'character',
    bag: roomMenus.inventoryScreen.isOpen,
    build: roomMenus.constructionMenu.isOpen,
    follower: room['followerMenu'].isOpen,
    switch: room.pm.human.isActive,
    minimap: room['miniMapExpanded'],
    hotbar: roomRig.potionsLeft(),
  };
}
type RoomState = ReturnType<typeof roomState>;
type ControlEffect = keyof RoomState;

function changedBetween(before: RoomState, after: RoomState): ControlEffect[] {
  const keys: readonly ControlEffect[] = [
    'pause',
    'journal',
    'spend',
    'bag',
    'build',
    'follower',
    'switch',
    'minimap',
    'hotbar',
  ];
  return keys.filter((key) => before[key] !== after[key]);
}

function resetRoom(): void {
  roomPause.close();
  roomMenus.closePanels();
  roomMenus.constructionMenu.close();
  room['followerMenu'].close();
  if (!room.pm.human.isActive) room['trySwitchActive']();
  if (room['miniMapExpanded']) room['toggleMiniMap']();
  roomRig.wound();
  roomRig.frame();
}

function miniMapPoint(): Point {
  const drawn = hudFrame(room);
  return centre(toCssRect(drawn.geometry.miniMap, drawn.uiScale));
}

room.pm.human.unspentPoints = 1;
roomRig.frame();
const controls: ReadonlyArray<{
  readonly name: string;
  readonly at: () => Point | null;
  readonly effect: ControlEffect;
}> = [
  { name: 'pause', at: () => dockPoint(room, 'pause'), effect: 'pause' },
  { name: 'bag', at: () => dockPoint(room, 'bag'), effect: 'bag' },
  { name: 'build', at: () => dockPoint(room, 'build'), effect: 'build' },
  { name: 'journal', at: () => dockPoint(room, 'journal'), effect: 'journal' },
  { name: 'follower', at: () => dockPoint(room, 'follower'), effect: 'follower' },
  { name: 'switch', at: () => dockPoint(room, 'switch'), effect: 'switch' },
  { name: 'minimap', at: miniMapPoint, effect: 'minimap' },
  { name: 'skill-point badge', at: () => badgePoint(room), effect: 'spend' },
  { name: 'potion slot', at: () => roomRig.slotPoint(), effect: 'hotbar' },
];
for (const control of controls) {
  resetRoom();
  const at = control.at();
  check(at !== null, `the ${control.name} control is drawn`);
  if (at === null) continue;
  const before = roomState();
  roomRig.tap(at);
  roomRig.frame();
  const changed = changedBetween(before, roomState());
  check(
    changed.length === 1 && changed[0] === control.effect,
    `a tap on ${control.name} changes only ${control.effect} (changed: ${changed.join(', ') || 'nothing'})`,
  );
}

resetRoom();
room['toggleMiniMap']();
roomRig.frame();
const expandedMap = miniMapPoint();
const beforeCollapse = roomState();
roomRig.tap(expandedMap);
roomRig.frame();
const collapseChanged = changedBetween(beforeCollapse, roomState());
check(
  collapseChanged.length === 1 && collapseChanged[0] === 'minimap',
  `a tap on the expanded minimap collapses it and does nothing else (changed: ${collapseChanged.join(', ') || 'nothing'})`,
);

console.log('\nThe hotbar fires on the press; a dock button acts on the release');

const pressers: ReadonlyArray<{
  readonly name: string;
  readonly down: (point: Point) => void;
  readonly up: (point: Point) => void;
}> = [
  {
    name: 'finger',
    down: (point) => roomRig.pointer.touchStart(TOUCH_ID, point.x, point.y),
    up: (point) => roomRig.pointer.touchEnd(TOUCH_ID, point.x, point.y),
  },
  {
    name: 'mouse',
    down: (point) => roomRig.pointer.mouseDown(point.x, point.y, PRIMARY_BUTTON),
    up: (point) => roomRig.pointer.mouseUp(point.x, point.y, PRIMARY_BUTTON),
  },
];
for (const presser of pressers) {
  resetRoom();
  room.pm.active().potionCooldownFrames = 0;
  const slot = roomRig.slotPoint();
  const potionsBefore = roomRig.potionsLeft();
  presser.down(slot);
  roomRig.frame();
  check(
    roomRig.potionsLeft() === potionsBefore - 1,
    `a ${presser.name} press on the potion slot drinks before the release`,
  );
  presser.up(slot);
  roomRig.frame();
  check(
    roomRig.potionsLeft() === potionsBefore - 1,
    `and its release drinks nothing more (${presser.name})`,
  );

  resetRoom();
  const pause = requireDockPoint(room, 'pause');
  presser.down(pause);
  roomRig.frame();
  check(!roomPause.isOpen, `a ${presser.name} press on pause does not pause yet`);
  presser.up(pause);
  roomRig.frame();
  check(roomPause.isOpen, `and its release pauses (${presser.name})`);
}
resetRoom();

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nverify:interior-hud-clicks passed');
process.exit(0);
