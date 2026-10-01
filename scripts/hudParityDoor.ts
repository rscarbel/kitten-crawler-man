/**
 * The door half of `verify:hud-parity`: the real `DungeonScene` and
 * `BuildingInteriorScene`, headless on a phone, walked through a door and back
 * with the minimap expanded and the HUD panel collapsed — both toggled outside
 * before going in, and the minimap toggled back inside before coming out. Every shared
 * button must stand on the same pixels on both sides of the door each way, so
 * the toggles have to come through it.
 *
 * Run by `verify-hud-parity.ts` as its own child process: the platform is
 * decided once, when the game's modules load.
 */

Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 1, userAgent: 'iPhone' },
  configurable: true,
});

const PHONE = { width: 390, height: 844, devicePixelRatio: 1 } as const;
const { installBrowserShim } = await import('./browserShim.js');
installBrowserShim(PHONE);
const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { gameContext } = await import('./nodeGameContext.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { LoadingOverlay } = await import('../src/ui/LoadingScreen.js');
const UI = await import('../src/systems/DungeonUIRenderer.js');

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type Outside = InstanceType<typeof DungeonScene>;
type Inside = InstanceType<typeof BuildingInteriorScene>;

/** More frames than the town's arrival screen ever needs to finish its work. */
const MAX_ARRIVAL_FRAMES = 3000;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');
setViewportSize(PHONE.width, PHONE.height);
const ctx = gameContext(PHONE.width, PHONE.height);

async function settleArrival(scene: Outside): Promise<boolean> {
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES; frame++) {
    const loading: unknown = Reflect.get(scene, 'arrivalLoading');
    if (!(loading instanceof LoadingOverlay) || !loading.isOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

/** The shared buttons outside, as this frame's render left the renderer's state. */
function outsideButtons(scene: Outside): Record<string, Rect> {
  scene.render(ctx);
  const miniMap = scene['miniMap'];
  return {
    pause: UI.pauseButtonRect(miniMap),
    bag: UI.bagButtonRect(miniMap),
    follower: UI.mobileFollowerButtonRect(miniMap),
    chip: UI.achievementChipRect(miniMap),
    journal: UI.journalButtonRect(miniMap),
  };
}

function insideButtons(scene: Inside): Record<string, Rect | null> {
  scene.render(ctx);
  const layout = scene['hudLayout']();
  return {
    pause: layout.pause,
    bag: layout.bag,
    follower: layout.follow,
    chip: layout.achievementChip,
    journal: layout.journal,
  };
}

function compare(
  outside: Record<string, Rect>,
  inside: Record<string, Rect | null>,
  when: string,
): void {
  for (const [name, rect] of Object.entries(outside)) {
    const other = inside[name] ?? null;
    const same =
      other !== null &&
      other.x === rect.x &&
      other.y === rect.y &&
      other.w === rect.w &&
      other.h === rect.h;
    check(same, `${when}: ${name} stands on the same pixels on both sides of the door`);
  }
}

function currentScene(manager: InstanceType<typeof SceneManager>): unknown {
  return manager['current'];
}

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

interface HudToggles {
  readonly miniMapExpanded: boolean;
  readonly hudCollapsed: boolean;
}

function outsideToggles(scene: Outside): HudToggles {
  return { miniMapExpanded: scene['miniMap'].isExpanded, hudCollapsed: scene['_hudCollapsed'] };
}

function insideToggles(scene: Inside): HudToggles {
  return {
    miniMapExpanded: scene['mobileHUD'].miniMapExpanded,
    hudCollapsed: scene['_hudCollapsed'],
  };
}

/**
 * The toggles themselves, not only the buttons: with the minimap expanded on a
 * phone, no button compared here moves with the HUD panel, so a dropped
 * collapse would pass a rect comparison.
 */
function checkToggles(expected: HudToggles, actual: HudToggles, when: string): void {
  check(
    actual.miniMapExpanded === expected.miniMapExpanded,
    `${when}: the minimap is ${expected.miniMapExpanded ? 'expanded' : 'normal'} on the far side`,
  );
  check(
    actual.hudCollapsed === expected.hudCollapsed,
    `${when}: the HUD panel is ${expected.hudCollapsed ? 'collapsed' : 'expanded'} on the far side`,
  );
}

function walkIn(scene: Outside): Inside {
  const building = scene['building'];
  if (building === null) throw new Error('the town has no buildings to enter');
  const door = scene['gameMap'].buildingEntries.find((entry) => entry.type === 'store');
  if (door === undefined) throw new Error('the town has no General Store');
  building['onEnterBuilding'](door);
  const inside = currentScene(sceneManager);
  if (!(inside instanceof BuildingInteriorScene)) throw new Error('the door led nowhere');
  return inside;
}

async function walkOut(scene: Inside): Promise<Outside> {
  scene['doExit']();
  const outside = currentScene(sceneManager);
  if (!(outside instanceof DungeonScene)) throw new Error('the door led nowhere on the way out');
  check(await settleArrival(outside), "the town's arrival screen finishes on the way out");
  return outside;
}

// Each toggle is flipped on only one side of one crossing, so each of the four
// hand-overs — either toggle, either direction — is the only thing that can
// carry its flip across: one that is dropped leaves the toggle at a value the
// check can tell apart.
street['miniMap'].toggle();
street['_hudCollapsed'] = !street['_hudCollapsed'];
const firstIn = 'minimap expanded and HUD panel toggled outside, walking in';
const streetToggles = outsideToggles(street);
const streetButtons = outsideButtons(street);
const shop = walkIn(street);
checkToggles(streetToggles, insideToggles(shop), firstIn);
compare(streetButtons, insideButtons(shop), firstIn);

const firstOut = 'minimap toggled back inside, walking out';
shop['mobileHUD'].toggleMiniMap();
const shopToggles = insideToggles(shop);
const shopButtons = insideButtons(shop);
const backOut = await walkOut(shop);
checkToggles(shopToggles, outsideToggles(backOut), firstOut);
compare(outsideButtons(backOut), shopButtons, firstOut);

const secondOut = 'HUD panel toggled back inside on a second visit, walking out';
const secondShop = walkIn(backOut);
checkToggles(shopToggles, insideToggles(secondShop), 'walking in again');
secondShop['_hudCollapsed'] = !secondShop['_hudCollapsed'];
const secondShopToggles = insideToggles(secondShop);
const secondShopButtons = insideButtons(secondShop);
const lastOut = await walkOut(secondShop);
checkToggles(secondShopToggles, outsideToggles(lastOut), secondOut);
compare(outsideButtons(lastOut), secondShopButtons, secondOut);

if (failures > 0) {
  console.error(`hud parity (door): ${failures} failure(s)`);
  process.exit(1);
}
console.log('hud parity (door): the toggles come through the door both ways');

export {};
