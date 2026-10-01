#!/usr/bin/env tsx
/**
 * Review renders of the Wayfinder's Anchor's travel menu with one, two and
 * three destinations unlocked, at desktop and phone sizes, into
 * `preview/travel-menu/`.
 *
 * Drawn through the real `TravelMenu` over a real floor-3 map, from a party
 * standing out in the wild, so the rows are the ones the game builds. Whether
 * the panel draws its touch footer is fixed when `Platform` loads, so the
 * phone renders run in a second process with a touch `navigator` installed
 * first.
 *
 *   npm run render:travel-menu
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas } from 'canvas';

const PHONE_FLAG = '--phone';
const isPhoneRun = process.argv.includes(PHONE_FLAG);

if (isPhoneRun) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints: 1, userAgent: 'iPhone' },
    configurable: true,
  });
}

const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
installCanvasGlobals();
const { asGameContext } = await import('./nodeGameContext.js');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { level3 } = await import('../src/levels/level3.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { hasRoomToMove } = await import('../src/map/findWalkableTile.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { createCircusQuestProgress } = await import('../src/core/CircusQuestProgress.js');
const { createBriarHollowState } = await import('../src/core/briarHollowState.js');
const { createAnchorQuestProgress } = await import('../src/core/AnchorQuestProgress.js');
const { TRAVEL_DESTINATIONS } = await import('../src/systems/travel/travelDestinations.js');
const { TravelMenu } = await import('../src/ui/TravelMenu.js');
const { setButtonMouseState } = await import('../src/ui/Button.js');

const DEVICE_PIXEL_RATIO = 2;
const OUT_DIR = `${PREVIEW_DIR}/travel-menu`;
const WORLD_SEED = 4242;
/** Far enough from every destination that no row reads "You are here". */
const WILDERNESS_MIN_DISTANCE_TILES = 40;
/** A pointer parked off every button, so no row renders hovered. */
const POINTER_OFF_SCREEN = -1000;
/** The scene's own clear colour, so the overlay reads as it does in game. */
const BACKDROP = '#1f2a1a';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

const DESKTOP_VIEWPORTS: readonly Viewport[] = [{ name: 'desktop', width: 1280, height: 720 }];
const PHONE_VIEWPORTS: readonly Viewport[] = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'small-phone', width: 320, height: 568 },
];

const map = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});

function wildernessTile(): { x: number; y: number } {
  const landings = TRAVEL_DESTINATIONS.flatMap((destination) => {
    const tile = destination.landingTile(map);
    return tile === null ? [] : [tile];
  });
  const size = map.structure.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const farFromAll = landings.every(
        (tile) => Math.hypot(tile.x - x, tile.y - y) >= WILDERNESS_MIN_DISTANCE_TILES,
      );
      if (farFromAll && hasRoomToMove(map, x, y)) return { x, y };
    }
  }
  throw new Error(`seed ${WORLD_SEED} has no open wilderness`);
}

const wild = wildernessTile();
const human = new HumanPlayer(wild.x, wild.y, TILE_SIZE);
const cat = new CatPlayer(wild.x + 1, wild.y, TILE_SIZE);

interface Unlocks {
  readonly name: string;
  readonly circusDone: boolean;
  readonly villageDone: boolean;
}

const UNLOCK_SETS: readonly Unlocks[] = [
  { name: 'one-row', circusDone: false, villageDone: false },
  { name: 'two-rows', circusDone: true, villageDone: false },
  { name: 'three-rows', circusDone: true, villageDone: true },
];

const viewports = isPhoneRun ? PHONE_VIEWPORTS : DESKTOP_VIEWPORTS;
for (const viewport of viewports) {
  for (const unlocks of UNLOCK_SETS) {
    const circus = createCircusQuestProgress();
    const briarHollow = createBriarHollowState();
    if (unlocks.circusDone) circus.stage = 'complete';
    if (unlocks.villageDone) briarHollow.quest.phase = 'complete';
    const menu = new TravelMenu(
      map,
      { circus, briarHollow, anchor: createAnchorQuestProgress() },
      () => false,
    );
    menu.open(human);

    setViewportSize(viewport.width, viewport.height);
    const canvas = createCanvas(
      viewport.width * DEVICE_PIXEL_RATIO,
      viewport.height * DEVICE_PIXEL_RATIO,
    );
    const nodeCtx = canvas.getContext('2d');
    nodeCtx.scale(DEVICE_PIXEL_RATIO, DEVICE_PIXEL_RATIO);
    nodeCtx.fillStyle = BACKDROP;
    nodeCtx.fillRect(0, 0, viewport.width, viewport.height);
    setButtonMouseState(POINTER_OFF_SCREEN, POINTER_OFF_SCREEN);
    menu.render(asGameContext(nodeCtx), human, cat);
    const out = writePreviewPng(
      `${OUT_DIR}/${viewport.name}-${unlocks.name}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(`wrote ${out}`);
  }
}

if (!isPhoneRun) {
  execFileSync('npx', ['tsx', fileURLToPath(import.meta.url), PHONE_FLAG], { stdio: 'inherit' });
}
