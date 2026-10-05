/**
 * Gate for the camera and the chrome inside buildings, at desktop and phone
 * viewport sizes, at both input densities and with the minimap normal and
 * expanded:
 *
 * - From every corner of every walk-in room, the room's far edges — the top of
 *   the north wall's tallest art included — come fully into the part of the
 *   screen the HUD leaves clear, with a little empty space beyond them; a room
 *   that fits an axis is centred in that clear part.
 * - Standing on any floor tile the party can reach, that tile is on screen and
 *   under none of the HUD's rects (unit frames and coins, room name, minimap,
 *   Pause, Bag, Build, Journal, Switch, Follow, Summon). A rat on a tile the
 *   chrome always covers is a rat the player cannot find.
 * - The room-name slot in the top band stays on screen and overlaps no dock
 *   button, the hotbar, the unit frames or the minimap's normal square; with
 *   the map expanded the bars may lie over the part it grew into, which the
 *   player opened only to look for a moment. A name too long for its slot
 *   ends in an ellipsis, which is reported. The skill-point badge sits on the
 *   unit frame's portrait, inside the frames block, so it needs no check of
 *   its own.
 *
 * "The room" is measured, not taken from the camera's own bounds: each room is
 * drawn through the same layers `BuildingInteriorScene` draws (tiles, ground
 * props, decorations, standing props) onto a padded transparent canvas, and the
 * opaque bounding box of the result is what has to fit. The camera, the HUD
 * layout, the occluders and the clear view are the scene's own functions.
 *
 * Three cameras are also run and must fail: one clamped to the tile grid over
 * the whole screen, one blind to the HUD (framing against the whole view), and
 * the name label as a full-width bar with the text centred on the screen. A
 * gate that passed any of them could not tell a sound camera from a broken one.
 *
 *   npm run verify:interior-camera
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { asGameContext } from './nodeGameContext';
import { TILE_SIZE } from '../src/core/constants';
import { level3 } from '../src/levels/level3';
import { GameMap, TOWER_FLOOR_COUNT } from '../src/map/GameMap';
import { createTownPlan, type BuildingKind } from '../src/map/town/townPlan';
import { BIG_TOP_ENTRY_KIND, BIG_TOP_ENTRY_NAME } from '../src/map/OverworldGenerator';
import { stampSafeRoomCounters } from '../src/map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout';
import {
  drawTownInteriorGroundProps,
  townInteriorPropFigures,
} from '../src/systems/townInteriorPropFigures';
import { measureWorldText } from '../src/ui/world/worldText';
import {
  ClearViewMemo,
  INTERIOR_CAMERA_MARGIN_PX,
  followCamera,
  hudClearView,
  interiorCameraBounds,
  interiorFocusRange,
  interiorMustSeeBounds,
  type WorldRect,
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
import { NO_INSETS, resolveViewport, type SizeClass } from '../src/ui/core/viewport';
import type { Rect } from '../src/ui/core/geom';
import type { Density } from '../src/ui/theme/tokens';
import { measureText } from '../src/ui/widgets/text';

interface Viewport {
  readonly w: number;
  readonly h: number;
}

/** Desktop and small desktop. */
const DESKTOP_VIEWPORTS: readonly Viewport[] = [
  { w: 1280, h: 720 },
  { w: 800, h: 600 },
];
/** Phones, portrait and landscape, down to the narrowest the game supports. */
const PHONE_PORTRAIT_VIEWPORTS: readonly Viewport[] = [
  { w: 390, h: 844 },
  { w: 375, h: 667 },
  { w: 320, h: 568 },
];
/** Every landscape phone but the smallest. */
const ROOMY_LANDSCAPE_VIEWPORTS: readonly Viewport[] = [
  { w: 844, h: 390 },
  { w: 667, h: 375 },
];
const SMALLEST_LANDSCAPE_VIEWPORT: Viewport = { w: 568, h: 320 };
const ALL_VIEWPORTS: readonly Viewport[] = [
  ...DESKTOP_VIEWPORTS,
  ...PHONE_PORTRAIT_VIEWPORTS,
  ...ROOMY_LANDSCAPE_VIEWPORTS,
  SMALLEST_LANDSCAPE_VIEWPORT,
];
/** Everywhere but the smallest landscape phone. */
const ALL_BUT_SMALLEST_LANDSCAPE: readonly Viewport[] = ALL_VIEWPORTS.filter(
  (viewport) => viewport !== SMALLEST_LANDSCAPE_VIEWPORT,
);

interface HudVariant {
  readonly label: string;
  readonly density: Density;
  readonly miniMapExpanded: boolean;
  /** Where the room-name slot is checked. */
  readonly viewports: readonly Viewport[];
  /** Where the camera is checked — every one of `viewports` unless said otherwise. */
  readonly cameraViewports?: readonly Viewport[];
}

/** The player's UI size the gate lays the HUD out at: one CSS pixel per UI unit. */
const GATE_UI_SIZE = 'medium';

/**
 * Every layout the chrome can take. Follow, Summon, Build and Journal are
 * always on: the most covered the screen gets.
 *
 * With the minimap expanded on the smallest landscape phone, the map reaches
 * most of the way down to the hotbar and the dock hangs beside it, so the
 * camera is not checked there: a player who opens the map on that screen has
 * chosen the map over the room. The room's name is checked everywhere, on
 * screen and clear of every button.
 */
const HUD_VARIANTS: readonly HudVariant[] = [
  { label: 'pointer', density: 'pointer', miniMapExpanded: false, viewports: ALL_VIEWPORTS },
  {
    label: 'pointer, minimap expanded',
    density: 'pointer',
    miniMapExpanded: true,
    viewports: ALL_VIEWPORTS,
    cameraViewports: ALL_BUT_SMALLEST_LANDSCAPE,
  },
  { label: 'touch', density: 'touch', miniMapExpanded: false, viewports: ALL_VIEWPORTS },
  {
    label: 'touch, minimap expanded',
    density: 'touch',
    miniMapExpanded: true,
    viewports: ALL_VIEWPORTS,
    cameraViewports: ALL_BUT_SMALLEST_LANDSCAPE,
  },
];

const FULL_CHROME: InteriorChrome = { follow: true, summon: true, build: true, journal: true };

/** Transparent space drawn around a room so art past its grid is caught, not clipped. */
const CAPTURE_PAD_TILES = 6;
const RGBA_STRIDE = 4;
const ALPHA_OFFSET = 3;
/** Alpha a pixel must exceed to count as drawn — the same cut the prop measure uses. */
const DRAWN_ALPHA_THRESHOLD = 8;
/** Sub-pixel slack for comparing screen positions computed in floating point. */
const EPSILON_PX = 0.5;
/**
 * How far off-centre a room that fits may sit. The camera centres its own
 * bounds, which count a decoration's declared reach rather than its painted
 * pixels, so the measured art can sit a few pixels off true centre.
 */
const CENTRING_TOLERANCE_TILES = 0.25;
const CENTRING_TOLERANCE_PX = TILE_SIZE * CENTRING_TOLERANCE_TILES;
/** Where `GameplayScene.computeCamera` centres on within the focus's tile. */
const FOCUS_TILE_CENTRE = 0.5;
/** The room the failing cameras are expected to fail on. */
const NEGATIVE_TEST_ROOM = 'Temple of the Sky';
/** Hidden-tile failures listed per room/layout/viewport before the rest are only counted. */
const HIDDEN_TILES_LISTED = 3;
/** A rejected label design: a full-width strip with the name centred at 13 px bold. */
const FULL_WIDTH_LABEL_TEXT_SIZE = 13;
const FULL_WIDTH_LABEL_TEXT_TOP = 8;
/** The phone viewport the full-width label is shown failing at. */
const FULL_WIDTH_LABEL_VIEWPORT: Viewport = { w: 390, h: 844 };
/** Frames the clear-view memo is asked for at one fixed layout; all but the first must hit. */
const MEMO_FRAMES = 60;
/** How many times the memo has computed after each step: once for the fixed layout, then once per change. */
const MEMO_COMPUTES = { fixedLayout: 1, afterResize: 2, afterRebuild: 3 } as const;

interface Tile {
  readonly x: number;
  readonly y: number;
}

interface Room {
  readonly label: string;
  /** The name its banner shows. */
  readonly title: string;
  readonly map: GameMap;
  /** What the room actually draws, in world pixels. */
  readonly drawn: WorldRect;
  /** Every tile the party can walk to from the door. */
  readonly reachable: readonly Tile[];
}

interface HudOnScreen {
  readonly geometry: HudGeometry;
  readonly uiScale: number;
  readonly size: SizeClass;
}

interface Frame {
  readonly view: Rect;
  readonly clear: Rect;
  readonly occluders: readonly Rect[];
}

type CameraFor = (map: GameMap, focus: Tile, frame: Frame) => { x: number; y: number };

let failures = 0;

function fail(label: string): void {
  console.log(` FAIL  ${label}`);
  failures++;
}

function buildInterior(
  name: string,
  kind: BuildingKind,
  floor: number,
  hasSafeRoom: boolean,
): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(kind, floor, name, hasSafeRoom);
  if (hasSafeRoom) {
    stampSafeRoomCounters(map);
    stampSafeRoomDecor(map);
  }
  map.invalidateAllTileArt();
  return map;
}

/** The opaque bounding box of everything the room draws, in world pixels. */
function measureDrawnBounds(map: GameMap): WorldRect {
  const cols = map.structure[0]?.length ?? 0;
  const rows = map.structure.length;
  const pad = CAPTURE_PAD_TILES * TILE_SIZE;
  const width = cols * TILE_SIZE + pad * 2;
  const height = rows * TILE_SIZE + pad * 2;
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const gameCtx = asGameContext(nodeCtx);
  const camX = -pad;
  const camY = -pad;
  map.renderCanvas(gameCtx, camX, camY, width, height);
  drawTownInteriorGroundProps(gameCtx, map, camX, camY, TILE_SIZE);
  map.renderDecorationsOverlay(gameCtx, camX, camY, width, height);
  const figures = [...townInteriorPropFigures(map)].sort((a, b) => a.y - b.y);
  for (const figure of figures) figure.render(gameCtx, camX, camY, TILE_SIZE);

  const pixels = nodeCtx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET] <= DRAWN_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { left: minX - pad, top: minY - pad, right: maxX + 1 - pad, bottom: maxY + 1 - pad };
}

/** Every walkable tile reachable from the door, four-connected. */
function reachableTiles(map: GameMap): Tile[] {
  const cols = map.structure[0]?.length ?? 0;
  const rows = map.structure.length;
  const seen = new Set<number>();
  const queue = [{ x: map.startTile.x, y: map.startTile.y }];
  seen.add(map.startTile.y * cols + map.startTile.x);
  const steps = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  // A for-of over an array visits what is pushed onto it mid-loop, which is the whole queue.
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

/** The HUD's layout on a screen of `viewport` CSS pixels, resolved as the scene's `UiRoot` resolves it. */
function hudFor(variant: HudVariant, viewport: Viewport): HudOnScreen {
  const resolved = resolveViewport({
    cssWidth: viewport.w,
    cssHeight: viewport.h,
    density: variant.density,
    uiSize: GATE_UI_SIZE,
    safeArea: NO_INSETS,
  });
  return {
    geometry: hudLayout({
      viewport: resolved.safe,
      size: resolved.size,
      density: resolved.density,
      miniMapExpanded: variant.miniMapExpanded,
      build: FULL_CHROME.build,
    }),
    uiScale: resolved.uiScale,
    size: resolved.size,
  };
}

/** The band the camera frames in (the hotbar's band is off its bottom), as the scene computes it. */
function cameraView(hud: HudOnScreen, viewport: Viewport): Rect {
  const hotbarBand = hotbarBandHeightCss(hud.geometry, hud.uiScale, viewport.h);
  return { x: 0, y: 0, w: viewport.w, h: viewport.h - hotbarBand };
}

/** The camera's view, and the part of it the chrome leaves clear. */
function frameFor(room: Room, hud: HudOnScreen, viewport: Viewport): Frame {
  const view = cameraView(hud, viewport);
  const occluders = interiorHudOccluders(hud.geometry, hud.uiScale, FULL_CHROME);
  const clear = hudClearView(
    view,
    occluders,
    interiorCameraBounds(room.map),
    interiorMustSeeBounds(room.map),
  );
  return { view, clear, occluders };
}

function focusOn(tile: Tile): { x: number; y: number } {
  return {
    x: (tile.x + FOCUS_TILE_CENTRE) * TILE_SIZE,
    y: (tile.y + FOCUS_TILE_CENTRE) * TILE_SIZE,
  };
}

const sceneCamera: CameraFor = (map, focus, frame) =>
  followCamera(
    focusOn(focus),
    interiorCameraBounds(map),
    frame.view,
    frame.clear,
    interiorFocusRange(map),
  );

/** The scene's camera framed against the whole view, as if the HUD were not there. */
const hudBlindCamera: CameraFor = (map, focus, frame) =>
  followCamera(focusOn(focus), interiorCameraBounds(map), frame.view);

/** A follow camera clamped to the tile grid over the whole screen. */
const gridClampedCamera: CameraFor = (map, focus, frame) => {
  const grid = {
    left: 0,
    top: 0,
    right: (map.structure[0]?.length ?? 0) * TILE_SIZE,
    bottom: map.structure.length * TILE_SIZE,
  };
  return followCamera(focusOn(focus), grid, frame.view);
};

interface AxisSpec {
  readonly name: 'horizontal' | 'vertical';
  readonly drawnStart: number;
  readonly drawnEnd: number;
  readonly clearStart: number;
  readonly clearEnd: number;
  readonly cameraOf: (camera: { x: number; y: number }) => number;
  readonly startEdge: string;
  readonly endEdge: string;
}

/**
 * The framing checks for one room in one frame: each edge can be brought into
 * the clear part of the screen with its margin from some tile the party can
 * reach, and an axis that fits is centred in it whatever the focus.
 */
function checkFraming(room: Room, frame: Frame, where: string, cameraFor: CameraFor): string[] {
  const problems: string[] = [];
  const cameras = room.reachable.map((tile) => ({
    tile,
    camera: cameraFor(room.map, tile, frame),
  }));
  const axes: AxisSpec[] = [
    {
      name: 'horizontal',
      drawnStart: room.drawn.left,
      drawnEnd: room.drawn.right,
      clearStart: frame.clear.x,
      clearEnd: frame.clear.x + frame.clear.w,
      cameraOf: (camera) => camera.x,
      startEdge: 'west',
      endEdge: 'east',
    },
    {
      name: 'vertical',
      drawnStart: room.drawn.top,
      drawnEnd: room.drawn.bottom,
      clearStart: frame.clear.y,
      clearEnd: frame.clear.y + frame.clear.h,
      cameraOf: (camera) => camera.y,
      startEdge: 'north (art top)',
      endEdge: 'south',
    },
  ];
  for (const axis of axes) {
    const needed = axis.drawnEnd - axis.drawnStart + INTERIOR_CAMERA_MARGIN_PX * 2;
    const available = axis.clearEnd - axis.clearStart;
    const gaps = cameras.map(({ camera }) => ({
      before: axis.drawnStart - axis.cameraOf(camera) - axis.clearStart,
      after: axis.clearEnd - (axis.drawnEnd - axis.cameraOf(camera)),
    }));
    if (needed <= available) {
      for (const gap of gaps) {
        const bothEdgesClear =
          gap.before >= INTERIOR_CAMERA_MARGIN_PX - EPSILON_PX &&
          gap.after >= INTERIOR_CAMERA_MARGIN_PX - EPSILON_PX;
        const centred = Math.abs(gap.before - gap.after) <= CENTRING_TOLERANCE_PX;
        if (!bothEdgesClear || !centred) {
          problems.push(
            `${where}: ${axis.name} fits but is framed ${gap.before.toFixed(1)} / ${gap.after.toFixed(1)} px from the clear edges`,
          );
          break;
        }
      }
      continue;
    }
    const bestBefore = Math.max(...gaps.map((gap) => gap.before));
    const bestAfter = Math.max(...gaps.map((gap) => gap.after));
    if (bestBefore < INTERIOR_CAMERA_MARGIN_PX - EPSILON_PX) {
      problems.push(
        `${where}: ${axis.startEdge} edge never shown clear of the HUD with its margin (best ${bestBefore.toFixed(1)} px)`,
      );
    }
    if (bestAfter < INTERIOR_CAMERA_MARGIN_PX - EPSILON_PX) {
      problems.push(
        `${where}: ${axis.endEdge} edge never shown clear of the HUD with its margin (best ${bestAfter.toFixed(1)} px)`,
      );
    }
  }
  return problems;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPSILON_PX &&
    b.x < a.x + a.w - EPSILON_PX &&
    a.y < b.y + b.h - EPSILON_PX &&
    b.y < a.y + a.h - EPSILON_PX
  );
}

/** Whether `inner` lies within `outer`, give or take {@link EPSILON_PX}. */
function rectWithin(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON_PX &&
    inner.x + inner.w <= outer.x + outer.w + EPSILON_PX &&
    inner.y >= outer.y - EPSILON_PX &&
    inner.y + inner.h <= outer.y + outer.h + EPSILON_PX
  );
}

/**
 * Standing on each reachable tile, that tile must be on screen and under no
 * HUD rect. Returns one problem per hidden tile.
 */
function checkTilesClearOfHud(
  room: Room,
  frame: Frame,
  where: string,
  cameraFor: CameraFor,
): string[] {
  const problems: string[] = [];
  for (const tile of room.reachable) {
    const camera = cameraFor(room.map, tile, frame);
    const onScreen: Rect = {
      x: tile.x * TILE_SIZE - camera.x,
      y: tile.y * TILE_SIZE - camera.y,
      w: TILE_SIZE,
      h: TILE_SIZE,
    };
    const inView = rectWithin(onScreen, frame.view);
    const covered = frame.occluders.some((occluder) => rectsOverlap(onScreen, occluder));
    if (!inView || covered) {
      const why = inView ? 'under the HUD' : 'off screen';
      problems.push(`${where}: floor tile (${tile.x},${tile.y}) is ${why} with the party on it`);
    }
  }
  return problems;
}

/**
 * The room-name slot: on screen, and clear of every dock button, the
 * minimap's normal square, the unit frames and the hotbar. A name too long for its slot ends in an
 * ellipsis, which is reported, not failed.
 */
function checkRoomNameSlot(
  hud: HudOnScreen,
  variant: HudVariant,
  viewport: Viewport,
  titles: readonly string[],
  measureCtx: CanvasRenderingContext2D,
): string[] {
  const where = `${variant.label} @ ${viewport.w}x${viewport.h}`;
  const problems: string[] = [];
  const { geometry, uiScale } = hud;
  const slotRect = roomNameSlot(geometry);
  const slot = slotRect === null ? null : toCssRect(slotRect, uiScale);
  const screen: Rect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
  const onScreen = slot !== null && rectWithin(slot, screen);
  if (slotRect === null || slot === null || !onScreen) {
    const why = slot === null ? 'has no slot' : `lands at y ${slot.y.toFixed(0)}, off the screen`;
    return [`${where}: the room's name ${why}`];
  }
  if (!(slotRect.w > 0)) problems.push(`${where}: the room-name slot is ${slotRect.w} wide`);
  const { buttons } = geometry;
  const others: Array<{ name: string; rect: Rect | null }> = [
    { name: 'unit frames', rect: geometry.framesBlock },
    { name: 'minimap', rect: geometry.normalMiniMap },
    { name: 'hotbar', rect: geometry.hotbar.strip },
    { name: 'Pause', rect: buttons.pause },
    { name: 'Bag', rect: buttons.bag },
    { name: 'Build', rect: buttons.build },
    { name: 'achievement chip', rect: buttons.chip },
    { name: 'Journal', rect: buttons.journal },
    { name: 'Switch', rect: buttons.switchButton },
    { name: 'Follow', rect: buttons.follower },
    { name: 'Summon', rect: buttons.summon },
  ];
  for (const other of others) {
    if (other.rect === null) continue;
    if (rectsOverlap(slot, toCssRect(other.rect, uiScale))) {
      problems.push(`${where}: the room-name slot overlaps the ${other.name}`);
    }
  }
  const textRoom = slotRect.w - geometry.theme.space.md * 2;
  const paint = { ctx: measureCtx, theme: geometry.theme };
  const cutShort = titles.filter(
    (title) => measureText(paint, `Inside: ${title}`, { role: 'label' }) > textRoom + EPSILON_PX,
  );
  if (cutShort.length > 0) {
    console.log(`  ${where}: cut short with an ellipsis: ${cutShort.join(', ')}`);
  }
  return problems;
}

await loadGameSpritesInNode();

const plan = createTownPlan(level3.mapSize);
const walkIns: Array<{ name: string; kind: BuildingKind; hasSafeRoom: boolean }> = [
  ...plan.buildings.map((b) => ({
    name: b.name,
    kind: b.kind,
    hasSafeRoom: b.hasSafeRoom === true,
  })),
  { name: plan.tower.name, kind: plan.tower.kind, hasSafeRoom: false },
  { name: BIG_TOP_ENTRY_NAME, kind: BIG_TOP_ENTRY_KIND, hasSafeRoom: false },
];

const rooms: Room[] = [];
for (const walkIn of walkIns) {
  const floors = walkIn.kind === 'tower' ? TOWER_FLOOR_COUNT : 1;
  for (let floor = 0; floor < floors; floor++) {
    const map = buildInterior(walkIn.name, walkIn.kind, floor, walkIn.hasSafeRoom);
    const label = floors > 1 ? `${walkIn.name} (floor ${floor})` : walkIn.name;
    const title = interiorRoomTitle(walkIn.name, floors > 1 ? floor : null);
    const drawn = measureDrawnBounds(map);
    const reachable = reachableTiles(map);
    rooms.push({
      label,
      title,
      map,
      drawn,
      reachable,
    });
    const cols = map.structure[0]?.length ?? 0;
    const headroom = Math.max(0, -drawn.top);
    console.log(
      `  ${label}: ${cols}x${map.structure.length} tiles, ${reachable.length} reachable, art rises ${headroom} px above the top row`,
    );
  }
}

const measureCanvas = createCanvas(1, 1);
const measureCtx = asGameContext(measureCanvas.getContext('2d'));
const titles = rooms.map((room) => room.title);

let pairs = 0;
let tilesChecked = 0;
const gridClampedProblems: string[] = [];
const hudBlindProblems: string[] = [];
for (const variant of HUD_VARIANTS) {
  for (const viewport of variant.viewports) {
    const hud = hudFor(variant, viewport);
    for (const problem of checkRoomNameSlot(hud, variant, viewport, titles, measureCtx)) {
      fail(problem);
    }
    const cameraViewports = variant.cameraViewports ?? variant.viewports;
    if (!cameraViewports.includes(viewport)) continue;
    for (const room of rooms) {
      pairs++;
      const where = `${room.label} @ ${variant.label} ${viewport.w}x${viewport.h}`;
      const frame = frameFor(room, hud, viewport);
      for (const problem of checkFraming(room, frame, where, sceneCamera)) fail(problem);
      const hidden = checkTilesClearOfHud(room, frame, where, sceneCamera);
      tilesChecked += room.reachable.length;
      for (const problem of hidden.slice(0, HIDDEN_TILES_LISTED)) fail(problem);
      if (hidden.length > HIDDEN_TILES_LISTED) {
        fail(`${where}: ${hidden.length - HIDDEN_TILES_LISTED} more hidden floor tile(s)`);
      }
      if (room.label === NEGATIVE_TEST_ROOM) {
        gridClampedProblems.push(...checkFraming(room, frame, where, gridClampedCamera));
        hudBlindProblems.push(...checkTilesClearOfHud(room, frame, where, hudBlindCamera));
      }
    }
  }
}

function reportNegative(name: string, problems: readonly string[]): void {
  if (problems.length === 0) {
    fail(`${name} passes every check on ${NEGATIVE_TEST_ROOM} — the gate has no teeth`);
    return;
  }
  console.log(
    `  ok   ${name} fails ${problems.length} check(s) on ${NEGATIVE_TEST_ROOM}, as it must:`,
  );
  for (const problem of problems.slice(0, HIDDEN_TILES_LISTED)) console.log(`         ${problem}`);
}

reportNegative('a grid-clamped camera', gridClampedProblems);
reportNegative('a camera blind to the HUD', hudBlindProblems);

const touchVariant = HUD_VARIANTS.find(
  (variant) => variant.density === 'touch' && !variant.miniMapExpanded,
);

// The name as a full-width bar with its text centred on the screen: on a phone
// the text runs under the minimap.
{
  const viewport = FULL_WIDTH_LABEL_VIEWPORT;
  const temple = rooms.find((room) => room.label === NEGATIVE_TEST_ROOM);
  if (touchVariant === undefined || temple === undefined) {
    fail('the full-width-label check could not find the touch layout or the temple');
  } else {
    const hud = hudFor(touchVariant, viewport);
    const text = `Inside: ${temple.title}`;
    const textWidth = measureWorldText(measureCtx, text, {
      size: FULL_WIDTH_LABEL_TEXT_SIZE,
      bold: true,
    }).width;
    const centredText: Rect = {
      x: viewport.w / 2 - textWidth / 2,
      y: FULL_WIDTH_LABEL_TEXT_TOP,
      w: textWidth,
      h: FULL_WIDTH_LABEL_TEXT_SIZE,
    };
    if (rectsOverlap(centredText, toCssRect(hud.geometry.miniMap, hud.uiScale))) {
      console.log(
        `  ok   a full-width centred label runs under the minimap at ${viewport.w}x${viewport.h}, as it must`,
      );
    } else {
      fail('a full-width centred label clears the minimap — the room-name check has no teeth');
    }
  }
}

// The scene's clear-view memo: at a fixed layout the chrome search runs once,
// not every frame, and it runs again when the layout or the room changes.
{
  const phoneViewport = PHONE_PORTRAIT_VIEWPORTS[0];
  const temple = walkIns.find((walkIn) => walkIn.name === NEGATIVE_TEST_ROOM);
  if (touchVariant === undefined || temple === undefined) {
    fail('the memo check could not find the touch layout or the temple');
  } else {
    const memo = new ClearViewMemo();
    let recomputes = 0;
    const map = buildInterior(temple.name, temple.kind, 1, temple.hasSafeRoom);
    const askFor = (viewport: Viewport): void => {
      const hud = hudFor(touchVariant, viewport);
      const view = cameraView(hud, viewport);
      const occluders = interiorHudOccluders(hud.geometry, hud.uiScale, FULL_CHROME);
      const bounds = interiorCameraBounds(map);
      const key = JSON.stringify({ occluders, view, bounds });
      memo.clearView(map, key, (mustSee) => {
        recomputes++;
        return hudClearView(view, occluders, bounds, mustSee);
      });
    };
    for (let frame = 0; frame < MEMO_FRAMES; frame++) askFor(phoneViewport);
    const atFixedLayout = recomputes;
    askFor({ w: phoneViewport.h, h: phoneViewport.w });
    const afterResize = recomputes;
    map.generateInterior(temple.kind, 1, temple.name, temple.hasSafeRoom);
    askFor({ w: phoneViewport.h, h: phoneViewport.w });
    const afterRebuild = recomputes;
    if (atFixedLayout !== MEMO_COMPUTES.fixedLayout) {
      fail(
        `the clear-view memo recomputed ${atFixedLayout} time(s) over ${MEMO_FRAMES} identical frames — it must hit after the first`,
      );
    } else if (afterResize !== MEMO_COMPUTES.afterResize) {
      fail('the clear-view memo did not recompute when the viewport changed');
    } else if (afterRebuild !== MEMO_COMPUTES.afterRebuild) {
      fail('the clear-view memo did not recompute when the room was rebuilt in place');
    } else {
      console.log(
        `  ok   the clear-view memo computed once over ${MEMO_FRAMES} identical frames, and again on a resize and a rebuild`,
      );
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} failure(s) across ${pairs} room/layout/viewport triples`);
  process.exit(1);
}
console.log(
  `\nok — ${pairs} room/layout/viewport triples framed clear of the HUD; ${tilesChecked} floor-tile views checked`,
);
