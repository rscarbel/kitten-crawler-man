/**
 * Review renders of a room framed under the interior HUD: the room as the
 * scene draws it, the party standing on the floor tile the chrome is most
 * likely to hide, and every HUD rect from the scene's own layout drawn over
 * it. Each shot is made twice — `before`, with a camera blind to the HUD and
 * the name as a full-width bar with centred text; `after`, with the scene's
 * camera and the room's name in its top-band slot — so the two can be
 * compared side by side.
 *
 * The HUD pieces are drawn as labelled boxes at their real rects rather than
 * with their own painters, which need a live `UiRoot` to draw at all.
 *
 *   npm run render:interior-hud
 *   npm run render:interior-hud -- --room="Temple of the Sky" --viewport=390x844 --density=pointer
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { asGameContext } from './nodeGameContext';
import { PREVIEW_DIR, writePreviewPng } from './previewOut';
import { TILE_SIZE } from '../src/core/constants';
import { level3 } from '../src/levels/level3';
import { GameMap } from '../src/map/GameMap';
import { createTownPlan } from '../src/map/town/townPlan';
import {
  drawTownInteriorGroundProps,
  townInteriorPropFigures,
} from '../src/systems/townInteriorPropFigures';
import { worldText } from '../src/ui/world/worldText';
import { worldPlate } from '../src/ui/world/worldShapes';
import {
  followCamera,
  hudClearView,
  interiorCameraBounds,
  interiorFocusRange,
  interiorMustSeeBounds,
} from '../src/scenes/interiorCamera';
import {
  hotbarBandHeightCss,
  interiorHudOccluders,
  interiorRoomTitle,
  roomNameSlot,
  type InteriorChrome,
} from '../src/scenes/interiorHud';
import { hudLayout, type HudGeometry } from '../src/ui/hud/hudLayout';
import { toCssRect } from '../src/ui/hud/HudSurface';
import { NO_INSETS, resolveViewport } from '../src/ui/core/viewport';
import { inset, overlaps, type Rect } from '../src/ui/core/geom';
import { text } from '../src/ui/widgets/text';
import type { Density } from '../src/ui/theme/tokens';

const OUT_DIR = `${PREVIEW_DIR}/playtest-r3`;
const DEFAULT_ROOMS = ['Temple of the Sky', "Old Hilda's Cottage"];
const DEFAULT_VIEWPORTS = ['390x844', '844x390'];
const DEFAULT_DENSITY: Density = 'touch';
const FULL_CHROME: InteriorChrome = { follow: true, summon: true, build: true, journal: true };
/** Height of the full-width name bar the `before` shot draws. */
const OLD_LABEL_BAR_HEIGHT = 28;
const OLD_LABEL_TEXT_TOP = 8;
const OLD_LABEL_TEXT_SIZE = 13;
const FOCUS_TILE_CENTRE = 0.5;
const MARKER_RADIUS_TILES = 0.3;
const HUD_LABEL_SIZE = 10;
const HUD_LABEL_PAD = 3;
/** Rendered at 2× so small type and a one-tile rat read in review. */
const RENDER_SCALE = 2;
const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string): string | null {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? null : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

interface Tile {
  readonly x: number;
  readonly y: number;
}

function reachableTiles(map: GameMap): Tile[] {
  const cols = map.structure[0]?.length ?? 0;
  const rows = map.structure.length;
  const seen = new Set<number>([map.startTile.y * cols + map.startTile.x]);
  const queue: Tile[] = [{ x: map.startTile.x, y: map.startTile.y }];
  const steps = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const tile of queue) {
    for (const { dx, dy } of steps) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const key = y * cols + x;
      if (seen.has(key) || !map.isWalkable(x, y)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return queue;
}

type Camera = { x: number; y: number };

function tileOnScreen(tile: Tile, camera: Camera): Rect {
  return {
    x: tile.x * TILE_SIZE - camera.x,
    y: tile.y * TILE_SIZE - camera.y,
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

function focusOn(tile: Tile): { x: number; y: number } {
  return {
    x: (tile.x + FOCUS_TILE_CENTRE) * TILE_SIZE,
    y: (tile.y + FOCUS_TILE_CENTRE) * TILE_SIZE,
  };
}

function drawRoom(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, w, h);
  map.renderCanvas(ctx, camera.x, camera.y, w, h);
  drawTownInteriorGroundProps(ctx, map, camera.x, camera.y, TILE_SIZE);
  map.renderDecorationsOverlay(ctx, camera.x, camera.y, w, h);
  const figures = [...townInteriorPropFigures(map)].sort((a, b) => a.y - b.y);
  for (const figure of figures) figure.render(ctx, camera.x, camera.y, TILE_SIZE);
}

function drawMarker(ctx: CanvasRenderingContext2D, rect: Rect, color: string, label: string): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, TILE_SIZE * MARKER_RADIUS_TILES, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  worldText(ctx, label, {
    x: cx,
    y: rect.y + rect.h,
    size: HUD_LABEL_SIZE,
    bold: true,
    color,
    outline: true,
    align: 'center',
  });
}

function drawChrome(ctx: CanvasRenderingContext2D, geometry: HudGeometry, uiScale: number): void {
  const { buttons } = geometry;
  const pieces: Array<{ name: string; rect: Rect | null }> = [
    { name: 'Frames', rect: geometry.framesBlock },
    { name: 'Minimap', rect: geometry.miniMap },
    { name: 'Pause', rect: buttons.pause },
    { name: 'Bag', rect: buttons.bag },
    { name: 'Build', rect: buttons.build },
    { name: 'Chip', rect: buttons.chip },
    { name: 'Journal', rect: buttons.journal },
    { name: 'Switch', rect: buttons.switchButton },
    { name: 'Follow', rect: buttons.follower },
    { name: 'Summon', rect: buttons.summon },
    { name: 'Hotbar', rect: geometry.hotbar.strip },
  ];
  for (const piece of pieces) {
    if (piece.rect === null) continue;
    const rect = toCssRect(piece.rect, uiScale);
    worldPlate(ctx, rect, { style: 'panel' });
    worldText(ctx, piece.name, {
      x: rect.x + HUD_LABEL_PAD,
      y: rect.y + HUD_LABEL_PAD,
      size: HUD_LABEL_SIZE,
      color: '#94a3b8',
    });
  }
}

/**
 * The room's name in its top-band slot, set by the HUD's own text widget so a
 * name too long for the slot ends in the same ellipsis it does in the game.
 */
function drawRoomName(
  ctx: CanvasRenderingContext2D,
  geometry: HudGeometry,
  uiScale: number,
  slot: Rect,
  title: string,
): void {
  ctx.save();
  ctx.scale(uiScale, uiScale);
  worldPlate(ctx, slot, { style: 'panel' });
  const textRect = inset(slot, { l: geometry.theme.space.md, r: geometry.theme.space.md });
  text({ ctx, theme: geometry.theme }, textRect, {
    text: `Inside: ${title}`,
    role: 'label',
    align: 'center',
  });
  ctx.restore();
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function drawOldLabel(ctx: CanvasRenderingContext2D, title: string, width: number): void {
  worldPlate(ctx, { x: 0, y: 0, w: width, h: OLD_LABEL_BAR_HEIGHT }, { fill: 'rgba(0,0,0,0.55)' });
  worldText(ctx, `Inside: ${title}`, {
    x: width / 2,
    y: OLD_LABEL_TEXT_TOP,
    size: OLD_LABEL_TEXT_SIZE,
    bold: true,
    color: '#d4edaa',
    align: 'center',
  });
}

await loadGameSpritesInNode();

const plan = createTownPlan(level3.mapSize);
const roomArg = stringArg('room');
const viewportArg = stringArg('viewport');
const densityArg = stringArg('density');
const density: Density =
  densityArg === 'pointer' || densityArg === 'touch' ? densityArg : DEFAULT_DENSITY;
const roomNames = roomArg === null ? DEFAULT_ROOMS : [roomArg];
const viewportSpecs = viewportArg === null ? DEFAULT_VIEWPORTS : [viewportArg];

for (const roomName of roomNames) {
  const building = plan.buildings.find((b) => b.name === roomName);
  if (building === undefined) {
    console.log(`no building named "${roomName}"`);
    process.exit(1);
  }
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(building.kind, 0, building.name, false);
  map.invalidateAllTileArt();
  const reachable = reachableTiles(map);
  const title = interiorRoomTitle(building.name, null);
  const slug = building.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  for (const spec of viewportSpecs) {
    const match = /^(\d+)x(\d+)$/.exec(spec);
    if (match === null) {
      console.log(`bad viewport "${spec}" — expected WIDTHxHEIGHT`);
      process.exit(1);
    }
    const w = Number(match[1]);
    const h = Number(match[2]);
    const resolved = resolveViewport({
      cssWidth: w,
      cssHeight: h,
      density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    });
    const geometry = hudLayout({
      viewport: resolved.safe,
      size: resolved.size,
      density: resolved.density,
      miniMapExpanded: false,
      build: FULL_CHROME.build,
    });
    const { uiScale } = resolved;
    const hotbarTop = h - hotbarBandHeightCss(geometry, uiScale, h);
    const occluders = interiorHudOccluders(geometry, uiScale, FULL_CHROME);
    const bounds = interiorCameraBounds(map);
    const oldView: Rect = {
      x: 0,
      y: OLD_LABEL_BAR_HEIGHT,
      w,
      h: hotbarTop - OLD_LABEL_BAR_HEIGHT,
    };
    const slotUi = roomNameSlot(geometry);
    const slot = slotUi === null ? null : toCssRect(slotUi, uiScale);
    const withoutRoomName = occluders.filter((rect) => slot === null || !sameRect(rect, slot));
    const oldOccluders: Rect[] = [...withoutRoomName, { x: 0, y: 0, w, h: OLD_LABEL_BAR_HEIGHT }];
    const oldCamera = (tile: Tile): Camera => followCamera(focusOn(tile), bounds, oldView);
    const view: Rect = { x: 0, y: 0, w, h: hotbarTop };
    const clear = hudClearView(view, occluders, bounds, interiorMustSeeBounds(map));
    const newCamera = (tile: Tile): Camera =>
      followCamera(focusOn(tile), bounds, view, clear, interiorFocusRange(map));

    // The tile the `before` camera hides worst: one it covers with the party on it,
    // furthest from the door.
    const hiddenBefore = reachable.filter((tile) =>
      oldOccluders.some((rect) => overlaps(tileOnScreen(tile, oldCamera(tile)), rect)),
    );
    const door = map.startTile;
    const byDistance = (a: Tile, b: Tile): number =>
      Math.hypot(b.x - door.x, b.y - door.y) - Math.hypot(a.x - door.x, a.y - door.y);
    const candidates = [...(hiddenBefore.length > 0 ? hiddenBefore : reachable)].sort(byDistance);
    if (candidates.length === 0) continue;
    const subject = candidates[0];
    const neighbour =
      reachable.find((tile) => Math.abs(tile.x - subject.x) + Math.abs(tile.y - subject.y) === 1) ??
      subject;
    console.log(
      `  ${building.name} @ ${spec} (${density}): ${hiddenBefore.length} floor tile(s) hidden under the HUD before; rat at (${subject.x},${subject.y})`,
    );

    for (const phase of ['before', 'after'] as const) {
      const canvas = createCanvas(w * RENDER_SCALE, h * RENDER_SCALE);
      const ctx = asGameContext(canvas.getContext('2d'));
      ctx.scale(RENDER_SCALE, RENDER_SCALE);
      const camera = phase === 'before' ? oldCamera(neighbour) : newCamera(neighbour);
      drawRoom(ctx, map, camera, w, h);
      drawMarker(ctx, tileOnScreen(subject, camera), '#ef4444', 'rat');
      drawMarker(ctx, tileOnScreen(neighbour, camera), '#4ade80', 'you');
      drawChrome(ctx, geometry, uiScale);
      if (phase === 'before') drawOldLabel(ctx, title, w);
      else if (slotUi !== null) drawRoomName(ctx, geometry, uiScale, slotUi, title);
      const densitySuffix = density === DEFAULT_DENSITY ? '' : `-${density}`;
      const out = writePreviewPng(
        `${OUT_DIR}/${slug}-${spec}${densitySuffix}-${phase}.png`,
        canvas.toBuffer('image/png'),
      );
      console.log(`    ${out}`);
    }
  }
}
