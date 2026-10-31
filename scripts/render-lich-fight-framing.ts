/**
 * Review renders of the Warden's fight framed under the HUD: the cattery as
 * the fight finds it, the party in the middle of the room, and the HUD drawn
 * as labelled plates at its real rects. Each shot is made twice: `before`,
 * the fight's cards stacked as separate cards with the room's name under
 * them and a camera blind to all of it; `after`, the countdown riding in the
 * boss card, the name gone, and the scene's camera (`wardenFightFraming.ts`).
 * The north wall row is outlined in red.
 *
 *   npm run render:lich-fight-framing
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { asGameContext } from './nodeGameContext';
import { PREVIEW_DIR, writePreviewPng } from './previewOut';
import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { TOWN_TOWER_ID } from '../src/map/buildingIds';
import { towerConditionsFor, towerStoreyIndex } from '../src/map/town/interiors/townCenterTower';
import { missingCatsProgressAt } from '../src/core/quests/missingCatsProgress';
import {
  drawTownInteriorGroundProps,
  townInteriorPropFigures,
} from '../src/systems/townInteriorPropFigures';
import {
  framedCamera,
  hudClearView,
  interiorCameraBounds,
  interiorFocusRange,
  interiorMustSeeBounds,
} from '../src/scenes/interiorCamera';
import { hotbarBandHeightCss, interiorHudOccluders } from '../src/scenes/interiorHud';
import { WARDEN_ARENA_ROWS } from '../src/systems/tower/TowerRitualSystem';
import { toCssRect } from '../src/ui/hud/HudSurface';
import { layoutTopBand } from '../src/ui/hud/topBand';
import { TOP_BAND_WIDTH } from '../src/ui/hud/topBandStack';
import type { HudGeometry } from '../src/ui/hud/hudLayout';
import type { Rect } from '../src/ui/core/geom';
import { worldText } from '../src/ui/world/worldText';
import { worldPlate } from '../src/ui/world/worldShapes';
import { UNZOOMED, worldPx } from '../src/core/rendering/camera';
import { hudStates, representativeFightCard, type HudState } from './phoneHudLayouts';

const OUT_DIR = `${PREVIEW_DIR}/missing-cats/lich-fight`;
const SCREENS: ReadonlyArray<{ readonly w: number; readonly h: number; readonly touch: boolean }> =
  [
    { w: 760, h: 390, touch: false },
    { w: 1280, h: 720, touch: false },
    { w: 844, h: 390, touch: true },
    { w: 390, h: 844, touch: true },
  ];
/** Where the party stands: the middle of the room, below the circle. */
const PARTY_TILE = { x: 10, y: 9 } as const;
const FOCUS_TILE_CENTRE = 0.5;
const NORTH_WALL_ROW = 0;
const RIDER_ROWS = 1;
const HUD_LABEL_SIZE = 10;
const HUD_LABEL_PAD = 3;
const MARKER_RADIUS_TILES = 0.3;
const WALL_OUTLINE_WIDTH = 2;
/** Rendered at 2× so small type reads in review. */
const RENDER_SCALE = 2;
/** The heights the stacked cards drew at before the countdown rode in the boss card, in UI units. */
const STACKED_COUNTDOWN_HEIGHT = 56;
const ROOM_NAME_HEIGHT = 40;

type Camera = { x: number; y: number };

function drawRoom(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, w, h);
  const view = {
    x: camera.x,
    y: camera.y,
    viewWidth: worldPx(w),
    viewHeight: worldPx(h),
    zoom: UNZOOMED,
  };
  map.renderCanvas(ctx, view);
  drawTownInteriorGroundProps(ctx, map, camera.x, camera.y, TILE_SIZE);
  map.renderDecorationsOverlay(ctx, view);
  const figures = [...townInteriorPropFigures(map)].sort((a, b) => a.y - b.y);
  for (const figure of figures) figure.render(ctx, camera.x, camera.y, TILE_SIZE);
}

function plate(ctx: CanvasRenderingContext2D, rect: Rect, label: string): void {
  worldPlate(ctx, rect, { style: 'panel' });
  worldText(ctx, label, {
    x: rect.x + HUD_LABEL_PAD,
    y: rect.y + HUD_LABEL_PAD,
    size: HUD_LABEL_SIZE,
    color: '#e2e8f0',
  });
}

function drawChrome(ctx: CanvasRenderingContext2D, geometry: HudGeometry, uiScale: number): void {
  const { buttons } = geometry;
  const pieces: Array<{ name: string; rect: Rect | null }> = [
    { name: 'Frames', rect: geometry.framesBlock },
    { name: 'Minimap', rect: geometry.miniMap },
    { name: 'Pause', rect: buttons.pause },
    { name: 'Bag', rect: buttons.bag },
    { name: 'Journal', rect: buttons.journal },
    { name: 'Keys', rect: buttons.keys },
    { name: 'Switch', rect: buttons.switchButton },
    { name: 'Hotbar', rect: geometry.hotbar.strip },
  ];
  for (const piece of pieces) {
    if (piece.rect !== null) plate(ctx, toCssRect(piece.rect, uiScale), piece.name);
  }
}

/** The fight's cards stacked one under another with the room's name last, as they were. */
function stackedBand(geometry: HudGeometry): Array<{ name: string; rect: Rect }> {
  const area = geometry.topBand;
  const w = Math.min(TOP_BAND_WIDTH.regular, area.w);
  const boss = representativeFightCard(geometry, 0)[0]?.rect.h ?? 0;
  const slots = layoutTopBand(
    area,
    [
      { id: 'Boss bar', priority: 'boss', w, h: boss },
      { id: 'Revive your teammate! 89s', priority: 'countdown', w, h: STACKED_COUNTDOWN_HEIGHT },
      { id: 'Inside: Town Center Tower (Cattery)', priority: 'banner', w, h: ROOM_NAME_HEIGHT },
    ],
    geometry.topBandObstacles,
    geometry.theme.space.sm,
    geometry.topBandFloor,
    geometry.topBandKeepClear,
  );
  return slots.map((slot) => ({ name: slot.id, rect: slot.rect }));
}

function frame(state: HudState, map: GameMap, phase: 'before' | 'after'): Camera {
  const { geometry, uiScale } = state;
  const cssH = state.height * uiScale;
  const card = representativeFightCard(geometry, RIDER_ROWS)[0]?.rect ?? null;
  const topInset = phase === 'after' && card !== null ? (card.y + card.h) * uiScale : 0;
  const bottomInset = hotbarBandHeightCss(geometry, uiScale, cssH);
  const view: Rect = {
    x: 0,
    y: topInset,
    w: state.width * uiScale,
    h: cssH - bottomInset - topInset,
  };
  const bounds = interiorCameraBounds(map);
  const focusRange = interiorFocusRange(map);
  const clear = hudClearView(
    view,
    interiorHudOccluders(geometry, uiScale, {
      follow: true,
      summon: true,
      build: true,
      journal: true,
    }),
    bounds,
    interiorMustSeeBounds(map),
    focusRange,
  );
  const focus = {
    x: (PARTY_TILE.x + FOCUS_TILE_CENTRE) * TILE_SIZE,
    y: (PARTY_TILE.y + FOCUS_TILE_CENTRE) * TILE_SIZE,
  };
  const rows = phase === 'after' ? WARDEN_ARENA_ROWS : null;
  return framedCamera(focus, bounds, view, clear, focusRange, rows);
}

await loadGameSpritesInNode();

const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
map.generateInterior('tower', towerStoreyIndex('cattery'), TOWN_TOWER_ID, false, {
  kind: 'tower',
  conditions: towerConditionsFor(missingCatsProgressAt('ritual')),
});
const cols = map.structure[0]?.length ?? 0;

for (const screen of SCREENS) {
  const state = hudStates(screen.w, screen.h, screen.touch ? 'touch' : 'pointer')[0];
  if (state === undefined) continue;
  const { geometry, uiScale } = state;
  for (const phase of ['before', 'after'] as const) {
    const canvas = createCanvas(screen.w * RENDER_SCALE, screen.h * RENDER_SCALE);
    const ctx = asGameContext(canvas.getContext('2d'));
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    const camera = frame(state, map, phase);
    drawRoom(ctx, map, camera, screen.w, screen.h);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = WALL_OUTLINE_WIDTH;
    ctx.strokeRect(-camera.x, NORTH_WALL_ROW * TILE_SIZE - camera.y, cols * TILE_SIZE, TILE_SIZE);
    const party = {
      x: PARTY_TILE.x * TILE_SIZE - camera.x + TILE_SIZE / 2,
      y: PARTY_TILE.y * TILE_SIZE - camera.y + TILE_SIZE / 2,
    };
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(party.x, party.y, TILE_SIZE * MARKER_RADIUS_TILES, 0, Math.PI * 2);
    ctx.fill();
    drawChrome(ctx, geometry, uiScale);
    const cards =
      phase === 'before'
        ? stackedBand(geometry)
        : representativeFightCard(geometry, RIDER_ROWS).map((piece) => ({
            name: 'Boss bar + objective + Revive 89s',
            rect: piece.rect,
          }));
    for (const card of cards) plate(ctx, toCssRect(card.rect, uiScale), card.name);
    const spec = `${screen.w}x${screen.h}${screen.touch ? '-touch' : ''}`;
    const out = writePreviewPng(
      `${OUT_DIR}/framing-${spec}-${phase}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(`  ${out}`);
  }
}
