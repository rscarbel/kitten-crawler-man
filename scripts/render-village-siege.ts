#!/usr/bin/env tsx
/**
 * Review render for the siege's dressing: the square with the bell at rest,
 * ringing, and cracked under the call-to-arms poster, at the scale the game
 * is played at; and the siege's HUD panel in each of its states, at a desktop
 * and a phone width. Written to `preview/village-siege-*.png`.
 *
 *   npm run render:village-siege
 */

import { createCanvas, type Canvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { asGameContext } from './nodeGameContext.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
const REVIEW_DEVICE_PIXEL_RATIO = 2;
const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants');
const { loadSprites } = await import('../src/core/SpriteLoader');
const { renderCanvas } = await import('../src/map/TileRenderer');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { drawText } = await import('../src/ui/TextBox');
const { VillageAmbience } = await import('../src/systems/briarHollow/VillageAmbience');
const { setViewportSize } = await import('../src/core/Viewport');
const { buildSiegeRig } = await import('./villageSiegeHarness');
const { IMMINENT_FRAMES } = await import('../src/systems/briarHollow/VillageAssaultSystem');
const { Necromancer } = await import('../src/creatures/Necromancer');
const { siegeHudSlot } = await import('../src/systems/briarHollow/siegeHudLayout');
const { expandedHudPanelRect } = await import('../src/ui/HUD');
const { hotbarStripRect } = await import('../src/ui/InventoryPanel');
const { setHudPanelRect, topCentreStripSlot } = await import('../src/systems/DungeonUIRenderer');
const { RESOURCE_HUD_HEIGHT, RESOURCE_HUD_WIDTH } =
  await import('../src/systems/briarHollow/ResourceHud');
const { MiniMapSystem } = await import('../src/systems/MiniMapSystem');
const { BOX_PRESETS, drawBox } = await import('../src/ui/Box');

const SEED = 7919;
const OUT_DIR = 'preview';
/** The ambience clocks the three bell states are drawn at: mid-swing for the ringing one. */
const REST_SECONDS = 1.25;
const RINGING_SECONDS = 1.6;
/** Tiles of the square shown round the bell. */
const SQUARE_MARGIN_TILES = 6;
const LABEL_SIZE_PX = 14;
const LABEL_COLOR = '#fde68a';
const DESKTOP = { w: 1280, h: 720 } as const;
const PHONE = { w: 568, h: 320 } as const;
const HUD_BACKDROP = '#2b3a2a';
const HUD_STATES = 4;
const HUD_LABEL_Y = 4;
/** Frames into the assault the panel is sampled at: a few waves in, the necromancer out. */
const WAVE_SAMPLE_FRAMES = 600;
/** The necromancer is drawn part-way through his fight. */
const NECRO_HP_SHARE_SHOWN = 0.6;
const NECRO_LEVEL_SHOWN = 6;
/** Long enough away for the warning to be counting down. */
const ABANDON_SAMPLE_FRAMES = 180;

await loadSprites('src/images/');
const { paintEnvironmentArtInNode } = await import('./nodeCanvasGlobals.js');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);

mkdirSync(OUT_DIR, { recursive: true });

function save(canvas: Canvas, name: string): void {
  const path = `${OUT_DIR}/village-siege-${name}.png`;
  writeFileSync(path, canvas.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

const rig = buildSiegeRig({ seed: SEED, assaultLevel: 6 });
const { map, site } = rig;
const bell = site.square.bellTile;
const noticeBoard = site.props.find((prop) => prop.prop === 'notice_board');
const minX = Math.min(bell.x, noticeBoard?.x ?? bell.x) - SQUARE_MARGIN_TILES;
const minY = Math.min(bell.y, noticeBoard?.y ?? bell.y) - SQUARE_MARGIN_TILES;
const maxX = Math.max(bell.x, noticeBoard?.x ?? bell.x) + SQUARE_MARGIN_TILES;
const maxY = Math.max(bell.y, noticeBoard?.y ?? bell.y) + SQUARE_MARGIN_TILES;
const viewW = (maxX - minX) * TILE_SIZE;
const viewH = (maxY - minY) * TILE_SIZE;

type BellState = 'rest' | 'ringing' | 'cracked';
const states: readonly BellState[] = ['rest', 'ringing', 'cracked'];
const square = createCanvas(viewW * states.length, viewH);
const squareCtx = asGameContext(square.getContext('2d'));
states.forEach((state, index) => {
  squareCtx.save();
  squareCtx.translate(index * viewW, 0);
  squareCtx.beginPath();
  squareCtx.rect(0, 0, viewW, viewH);
  squareCtx.clip();
  const camX = minX * TILE_SIZE;
  const camY = minY * TILE_SIZE;
  renderCanvas(squareCtx, map.structure, TILE_SIZE, camX, camY, viewW, viewH);
  const ambience = new VillageAmbience();
  ambience.update(map, state === 'ringing' ? RINGING_SECONDS : REST_SECONDS);
  ambience.bell.ringing = state === 'ringing';
  ambience.bell.cracked = state === 'cracked';
  ambience.noticeBoard.callToArms = state !== 'rest';
  const draws: Array<{ sortY: number; draw: () => void }> = [];
  for (const { tx, ty, sortYAnchorPx } of map.getVisibleDecorationTiles(camX, camY, viewW, viewH)) {
    draws.push({
      sortY: ty * TILE_SIZE + sortYAnchorPx,
      draw: () => map.drawDecorationAt(squareCtx, tx, ty, camX, camY),
    });
  }
  for (const prop of ambience.renderEntities()) {
    draws.push({
      sortY: prop.y + TILE_SIZE,
      draw: () => prop.render(squareCtx, camX, camY, TILE_SIZE),
    });
  }
  draws.sort((a, b) => a.sortY - b.sortY);
  for (const item of draws) item.draw();
  ambience.renderAbove(squareCtx, camX, camY, viewW, viewH);
  drawText(squareCtx, state, {
    x: 4,
    y: 4,
    size: LABEL_SIZE_PX,
    color: LABEL_COLOR,
    outline: true,
  });
  squareCtx.restore();
});
save(square, 'square');

// ── The HUD panel ────────────────────────────────────────────────────────

const assault = rig.kit.assault;
if (assault === null) throw new Error('no assault');
rig.state.quest.phase = 'fortifying';
assault.begin();

interface HudShot {
  readonly label: string;
  readonly prepare: () => void;
}
const shots: HudShot[] = [
  { label: 'countdown', prepare: () => rig.step() },
  {
    label: 'wave 1, bell struck',
    prepare: () => {
      for (let i = 0; i < IMMINENT_FRAMES + WAVE_SAMPLE_FRAMES; i++) rig.step();
      rig.kit.defences?.defense.damage({ kind: 'bell' }, TILE_SIZE, null, 'melee');
    },
  },
  {
    label: 'the necromancer out',
    prepare: () => {
      const necro = new Necromancer(bell.x + SQUARE_MARGIN_TILES, bell.y, TILE_SIZE);
      necro.applyMobLevel(NECRO_LEVEL_SHOWN);
      necro.hp = necro.maxHp * NECRO_HP_SHARE_SHOWN;
      Object.defineProperty(assault, 'activeNecromancer', { value: necro });
    },
  },
  {
    label: 'abandoning',
    prepare: () => {
      rig.human.x = (site.palisadeBounds.x + site.palisadeBounds.w + 60) * TILE_SIZE;
      for (let i = 0; i < ABANDON_SAMPLE_FRAMES; i++) rig.step();
    },
  },
];

const miniMap = new MiniMapSystem(map);
/** The minimap's inset from the top-right corner, as the game draws it. */
const MINIMAP_MARGIN = 8;
const sizes = [DESKTOP, PHONE];
const sheets = sizes.map((size) => createCanvas(size.w, size.h * HUD_STATES));
shots.forEach((shot, index) => {
  shot.prepare();
  sizes.forEach((size, sizeIndex) => {
    setViewportSize(size.w, size.h);
    const sheetCtx = asGameContext(sheets[sizeIndex].getContext('2d'));
    sheetCtx.save();
    sheetCtx.translate(0, index * size.h);
    sheetCtx.fillStyle = HUD_BACKDROP;
    sheetCtx.fillRect(0, 0, size.w, size.h);
    // The chrome the panel must keep clear of, outlined, and the panel at the
    // slot the game itself would give it on this window.
    const hudRect = expandedHudPanelRect();
    setHudPanelRect(hudRect);
    const strip = topCentreStripSlot(miniMap, hudRect, RESOURCE_HUD_WIDTH);
    const mapSize = miniMap.NORMAL_SIZE;
    const slot = siegeHudSlot(miniMap, hudRect);
    const outlines = [
      hudRect,
      hotbarStripRect(),
      { x: size.w - MINIMAP_MARGIN - mapSize, y: MINIMAP_MARGIN, w: mapSize, h: mapSize },
      // The strip is not drawn where the panel takes its place.
      ...(slot.hidesResourceStrip
        ? []
        : [
            {
              x: strip.x,
              y: strip.y,
              w: RESOURCE_HUD_WIDTH * strip.scale,
              h: RESOURCE_HUD_HEIGHT * strip.scale,
            },
          ]),
    ];
    for (const rect of outlines) {
      drawBox(sheetCtx, {
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        ...BOX_PRESETS.panel,
      });
    }
    assault.renderHud(sheetCtx, slot);
    drawText(sheetCtx, shot.label, {
      x: 4,
      y: HUD_LABEL_Y,
      size: LABEL_SIZE_PX,
      color: LABEL_COLOR,
      outline: true,
    });
    sheetCtx.restore();
  });
});
sizes.forEach((size, index) => save(sheets[index], `hud-${size.w}x${size.h}`));
rig.dispose();
