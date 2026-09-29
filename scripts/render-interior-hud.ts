/**
 * Review renders of a room framed under the interior HUD: the room as the
 * scene draws it, the party standing on the floor tile the chrome is most
 * likely to hide, and every HUD rect from the scene's own layout drawn over
 * it. Each shot is made twice — `before`, with a camera blind to the HUD and
 * the name as a full-width bar with centred text; `after`, with the scene's
 * camera and name plate — so the two can be compared side by side.
 *
 * The HUD pieces are drawn as labelled boxes at their real rects rather than
 * with their own painters, which need a live phone platform to draw at all.
 *
 *   npm run render:interior-hud
 *   npm run render:interior-hud -- --room="Temple of the Sky" --viewport=390x844
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { asGameContext } from './nodeGameContext';
import { PREVIEW_DIR, writePreviewPng } from './previewOut';
import { TILE_SIZE } from '../src/core/constants';
import { level3 } from '../src/levels/level3';
import { setViewportSize } from '../src/core/Viewport';
import { GameMap } from '../src/map/GameMap';
import { createTownPlan } from '../src/map/town/townPlan';
import {
  drawTownInteriorGroundProps,
  townInteriorPropFigures,
} from '../src/systems/townInteriorPropFigures';
import { hotbarStripRect } from '../src/ui/InventoryPanel';
import { drawBox, BOX_PRESETS } from '../src/ui/Box';
import { drawText } from '../src/ui/TextBox';
import {
  followCamera,
  hudClearView,
  interiorCameraBounds,
  interiorFocusRange,
  interiorMustSeeBounds,
  type ScreenRect,
} from '../src/scenes/interiorCamera';
import {
  drawInteriorNameplate,
  interiorHudLayout,
  interiorHudOccluders,
  interiorRoomTitle,
  type InteriorHudLayout,
} from '../src/scenes/interiorHudLayout';
import type { Rect } from '../src/systems/MobileHUDSystem';

const OUT_DIR = `${PREVIEW_DIR}/playtest-r3`;
const DEFAULT_ROOMS = ['Temple of the Sky', "Old Hilda's Cottage"];
const DEFAULT_VIEWPORTS = ['390x844', '844x390'];
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

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

type Camera = { x: number; y: number };

function tileOnScreen(tile: Tile, camera: Camera): ScreenRect {
  return {
    left: tile.x * TILE_SIZE - camera.x,
    top: tile.y * TILE_SIZE - camera.y,
    right: (tile.x + 1) * TILE_SIZE - camera.x,
    bottom: (tile.y + 1) * TILE_SIZE - camera.y,
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

function drawMarker(
  ctx: CanvasRenderingContext2D,
  rect: ScreenRect,
  color: string,
  label: string,
): void {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, TILE_SIZE * MARKER_RADIUS_TILES, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawText(ctx, label, {
    x: cx,
    y: rect.bottom,
    size: HUD_LABEL_SIZE,
    bold: true,
    color,
    outline: true,
    align: 'center',
  });
}

function drawChrome(ctx: CanvasRenderingContext2D, layout: InteriorHudLayout): void {
  const pieces: Array<{ name: string; rect: Rect | null }> = [
    { name: 'HUD', rect: layout.hud },
    { name: 'Minimap', rect: layout.miniMap },
    { name: 'Pause', rect: layout.pause },
    { name: 'Gear', rect: layout.gear },
    { name: 'Bag', rect: layout.bag },
    { name: 'Switch', rect: layout.switchButton },
    { name: 'Follow', rect: layout.follow },
    { name: 'Summon', rect: layout.summon },
  ];
  for (const piece of pieces) {
    const rect = piece.rect;
    if (rect === null) continue;
    drawBox(ctx, { x: rect.x, y: rect.y, width: rect.w, height: rect.h, ...BOX_PRESETS.panel });
    drawText(ctx, piece.name, {
      x: rect.x + HUD_LABEL_PAD,
      y: rect.y + HUD_LABEL_PAD,
      size: HUD_LABEL_SIZE,
      color: '#94a3b8',
    });
  }
  const hotbar = hotbarStripRect();
  drawBox(ctx, {
    x: hotbar.x,
    y: hotbar.y,
    width: hotbar.w,
    height: hotbar.h,
    ...BOX_PRESETS.panel,
  });
  drawText(ctx, 'Hotbar', {
    x: hotbar.x + HUD_LABEL_PAD,
    y: hotbar.y + HUD_LABEL_PAD,
    size: HUD_LABEL_SIZE,
    color: '#94a3b8',
  });
}

function drawOldLabel(ctx: CanvasRenderingContext2D, title: string, width: number): void {
  drawBox(ctx, { x: 0, y: 0, width, height: OLD_LABEL_BAR_HEIGHT, fill: 'rgba(0,0,0,0.55)' });
  drawText(ctx, `Inside: ${title}`, {
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
    setViewportSize(w, h);
    const hotbarTop = hotbarStripRect().y;
    const layout = interiorHudLayout({
      viewportWidth: w,
      viewportHeight: h,
      mobile: true,
      hudCollapsed: true,
      miniMapExpanded: false,
      hotbarBandHeight: h - hotbarTop,
      followButton: true,
      summonButton: true,
    });
    const occluders = interiorHudOccluders(layout);
    const bounds = interiorCameraBounds(map);
    const oldView = { left: 0, top: OLD_LABEL_BAR_HEIGHT, right: w, bottom: hotbarTop };
    const withoutPlate = interiorHudOccluders({
      ...layout,
      nameplate: null,
    });
    const oldOccluders = [
      ...withoutPlate,
      { left: 0, top: 0, right: w, bottom: OLD_LABEL_BAR_HEIGHT },
    ];
    const oldCamera = (tile: Tile): Camera => followCamera(focusOn(tile), bounds, oldView);
    const view = { left: 0, top: 0, right: w, bottom: hotbarTop };
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
      `  ${building.name} @ ${spec}: ${hiddenBefore.length} floor tile(s) hidden under the HUD before; rat at (${subject.x},${subject.y})`,
    );

    for (const phase of ['before', 'after'] as const) {
      const canvas = createCanvas(w * RENDER_SCALE, h * RENDER_SCALE);
      const ctx = asGameContext(canvas.getContext('2d'));
      ctx.scale(RENDER_SCALE, RENDER_SCALE);
      const camera = phase === 'before' ? oldCamera(neighbour) : newCamera(neighbour);
      drawRoom(ctx, map, camera, w, h);
      drawMarker(ctx, tileOnScreen(subject, camera), '#ef4444', 'rat');
      drawMarker(ctx, tileOnScreen(neighbour, camera), '#4ade80', 'you');
      drawChrome(ctx, layout);
      if (phase === 'before') drawOldLabel(ctx, title, w);
      else if (layout.nameplate !== null) drawInteriorNameplate(ctx, layout.nameplate, title);
      const out = writePreviewPng(
        `${OUT_DIR}/${slug}-${spec}-${phase}.png`,
        canvas.toBuffer('image/png'),
      );
      console.log(`    ${out}`);
    }
  }
}
