#!/usr/bin/env tsx
/**
 * Review renders of the Wayfinder's Anchor's travel menu with one, two and
 * three destinations unlocked, at desktop and phone sizes, into
 * `preview/travel-menu/`.
 *
 * Drawn through the real `TravelMenu` and the shop screen it is mounted on,
 * in a real `UiRoot`, over a real floor-3 map, from a party standing out in
 * the wild, so the rows are the ones the game builds.
 *
 *   npm run render:travel-menu
 */

import { createCanvas } from 'canvas';

const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
installCanvasGlobals();
const { asGameContext } = await import('./nodeGameContext.js');
const { PREVIEW_DIR, writePreviewPng } = await import('./previewOut.js');
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
const { UiRoot } = await import('../src/ui/core/UiRoot.js');
const { NO_INSETS } = await import('../src/ui/core/viewport.js');
const { shopScreenSurface } = await import('../src/ui/screens/shop/ShopScreen.js');

type Density = import('../src/ui/theme/tokens.js').Density;
type ViewportInput = import('../src/ui/core/viewport.js').ViewportInput;

const OUT_DIR = `${PREVIEW_DIR}/travel-menu`;
const WORLD_SEED = 4242;
/** Far enough from every destination that no row reads "You are here". */
const WILDERNESS_MIN_DISTANCE_TILES = 40;
/** The scene's own clear colour, so the overlay reads as it does in game. */
const BACKDROP = '#1f2a1a';
const FRAME_MS = 16;
/** Long enough for the panel's open tween to settle. */
const SETTLE_MS = 1000;

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly density: Density;
}

const VIEWPORTS: readonly Viewport[] = [
  { name: 'desktop', width: 1280, height: 720, density: 'pointer' },
  { name: 'phone-portrait', width: 390, height: 844, density: 'touch' },
  { name: 'phone-landscape', width: 844, height: 390, density: 'touch' },
  { name: 'small-phone', width: 568, height: 320, density: 'touch' },
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

for (const viewport of VIEWPORTS) {
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

    let clock = 0;
    const viewportInput = (): ViewportInput => ({
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      density: viewport.density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    });
    const root = new UiRoot({
      audio: null,
      viewport: viewportInput,
      now: () => clock,
      warn: () => undefined,
    });
    root.mount(
      shopScreenSurface({
        id: 'travel-menu',
        session: menu.session,
        party: () => ({ active: human, companion: cat }),
      }),
    );
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = asGameContext(canvas.getContext('2d'));
    const frame = (): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      root.frame(ctx);
    };
    clock += FRAME_MS;
    frame();
    clock += SETTLE_MS;
    frame();
    const out = writePreviewPng(
      `${OUT_DIR}/${viewport.name}-${unlocks.name}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(`wrote ${out}`);
  }
}
