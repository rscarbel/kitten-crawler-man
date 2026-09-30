#!/usr/bin/env tsx
/**
 * A press inside a building reaches whatever is drawn on top at that point.
 *
 * The interior draws its right-hand HUD pieces — Build, the Journal, the
 * achievement chip — under every panel the room can raise, so a panel's
 * button can sit over one of them. On a 390x844 phone the General Store's
 * panel spans the width of the screen and its Buy column lands on Build: a
 * tap on Buy must not open the Construction menu behind it.
 *
 * Runs the real `BuildingInteriorScene` headless on a phone-sized viewport,
 * renders a frame and clicks through its own `handleClick`.
 *
 *   npm run verify:interior-hud-clicks
 */

import type { Rect } from '../src/systems/MobileHUDSystem';

// Before any game module loads: the platform is decided once, at import.
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 1, userAgent: 'iPhone' },
  configurable: true,
});

const PHONE = { width: 390, height: 844, devicePixelRatio: 1 } as const;
const { installBrowserShim } = await import('./browserShim.js');
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
const { setButtonMouseState } = await import('../src/ui/Button.js');

const WORLD_SEED = 1;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

check(platform.isMobile, 'the harness runs as a phone');
setViewportSize(PHONE.width, PHONE.height);
const ctx = gameContext(PHONE.width, PHONE.height);

const town = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
const store = town.buildingEntries.find((entry) => entry.type === 'store');
if (store === undefined) throw new Error('the town has no General Store');

const human = new HumanPlayer(0, 0, TILE_SIZE);
const cat = new CatPlayer(1, 0, TILE_SIZE);
teachBoth(human, cat, 'construction');
const village = createBriarHollowState();
village.unlocks.construction.push('trebuchet', 'snare');

const scene = new BuildingInteriorScene(
  store,
  snapPlayer(human),
  snapPlayer(cat),
  level3.xpDiminishingTiers,
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
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  village,
);

// Private collaborators, reached by name: the scene has no public way to open
// its counter, and the check is about what a press reaches, not how the panel
// was opened.
const shop = scene['shop'];
const menus = scene['menus'];
if (shop === null) throw new Error('the General Store built no shop');

function frame(): void {
  setButtonMouseState(0, 0, false);
  scene.render(ctx);
}

frame();
const layout = scene['hudLayout']();
const build: Rect | null = layout.build;
check(build !== null, 'the Build button is laid out once Construction is unlocked');

if (build !== null) {
  const centre = { x: build.x + build.w / 2, y: build.y + build.h / 2 };
  scene.handleClick(centre.x, centre.y);
  check(menus.constructionMenu.isOpen, 'a press on Build with nothing over it opens the menu');
  menus.constructionMenu.close();

  // The shop's panel is modal and spans the screen, so every point on Build
  // is under it; the centre sits in the panel's Buy column on this phone.
  shop.shopOpen = true;
  frame();
  scene.handleClick(centre.x, centre.y);
  check(
    !menus.constructionMenu.isOpen,
    'a press on Build under the open shop does not open the Construction menu',
  );
  check(shop.shopOpen, 'the press went to the shop, which is still open');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nverify:interior-hud-clicks passed');
process.exit(0);
