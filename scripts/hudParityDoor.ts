/**
 * The door half of `verify:hud-parity`: the real `DungeonScene` and
 * `BuildingInteriorScene`, headless, walked through a door and back with the
 * minimap expanded outside before going in and toggled back inside before
 * coming out. Every shared HUD piece — the unit frames, the minimap, Pause,
 * Bag, the Follower button, the hotbar — must stand on the same pixels on both
 * sides of the door each way, so the toggle has to come through it.
 *
 * Run by `verify-hud-parity.ts` as its own child process, once as a phone and
 * once as a desktop (`HUD_DOOR_DEVICE`): the platform is decided once, when
 * the game's modules load.
 */

const onPhone = process.env.HUD_DOOR_DEVICE !== 'desktop';
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: onPhone ? 1 : 0, userAgent: onPhone ? 'iPhone' : 'Desktop' },
  configurable: true,
});

const SCREEN = onPhone
  ? ({ width: 390, height: 844, devicePixelRatio: 1 } as const)
  : ({ width: 1280, height: 720, devicePixelRatio: 1 } as const);
const { installBrowserShim } = await import('./browserShim.js');
installBrowserShim(SCREEN);
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

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type Outside = InstanceType<typeof DungeonScene>;
type Inside = InstanceType<typeof BuildingInteriorScene>;

/** More frames than the town's arrival screen ever needs to finish its work. */
const MAX_ARRIVAL_FRAMES = 3000;
const device = onPhone ? 'phone' : 'desktop';

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${device}: ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');
setViewportSize(SCREEN.width, SCREEN.height);
const ctx = gameContext(SCREEN.width, SCREEN.height);

async function settleArrival(scene: Outside): Promise<boolean> {
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES; frame++) {
    const loading: unknown = Reflect.get(scene, 'arrivalLoading');
    if (!(loading instanceof LoadingOverlay) || !loading.isOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

/** The shared pieces as the HUD drew them this frame. */
function shownPieces(scene: Outside | Inside): Record<string, Rect | null> {
  scene.render(ctx);
  const frame = scene instanceof DungeonScene ? scene['hud'].frame : scene['hud'].frame;
  if (frame === null) throw new Error('the HUD drew nothing');
  const { geometry, dock } = frame;
  return {
    frames: geometry.framesBlock,
    minimap: geometry.miniMap,
    hotbar: geometry.hotbar.strip,
    pause: dock.get('pause') ?? null,
    bag: dock.get('bag') ?? null,
    follower: dock.get('follower') ?? null,
    switch: dock.get('switch') ?? null,
  };
}

function compare(
  outside: Record<string, Rect | null>,
  inside: Record<string, Rect | null>,
  when: string,
): void {
  for (const [name, rect] of Object.entries(outside)) {
    const other = inside[name] ?? null;
    const same =
      rect === null || other === null
        ? rect === other
        : other.x === rect.x && other.y === rect.y && other.w === rect.w && other.h === rect.h;
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

street['miniMap'].toggle();
const firstIn = 'minimap expanded outside, walking in';
const streetPieces = shownPieces(street);
const shop = walkIn(street);
check(shop['miniMapExpanded'], `${firstIn}: the minimap is still expanded inside`);
compare(streetPieces, shownPieces(shop), firstIn);

const firstOut = 'minimap toggled back inside, walking out';
shop['toggleMiniMap']();
const shopPieces = shownPieces(shop);
const backOut = await walkOut(shop);
check(!backOut['miniMap'].isExpanded, `${firstOut}: the minimap is normal again outside`);
compare(shownPieces(backOut), shopPieces, firstOut);

if (failures > 0) {
  console.error(`hud parity (door, ${device}): ${failures} failure(s)`);
  process.exit(1);
}
console.log(
  `hud parity (door, ${device}): the toggle and every piece come through the door both ways`,
);

export {};
