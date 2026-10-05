#!/usr/bin/env tsx
/**
 * Renders the UI gallery headless through a real `UiRoot`: the widget sheet
 * with every input-driven widget in every state, and sample screens built
 * from widgets, at each review viewport and each UI size. The same fixture
 * surfaces back the `?ui` route in the browser.
 *
 * The widget sheet is rendered at the real viewport (so a phone gets the
 * phone layout) and scrolled page by page; the pages are stitched into one
 * tall PNG. Hover, pressed and focused states are produced the way a player
 * produces them, by feeding pointer gestures and Tab presses into the root,
 * one cell at a time, each scrolled into view, captured and composited in.
 *
 * Run: npm run render:ui-gallery            (writes preview/ui-gallery/)
 *      npm run render:ui-gallery -- --only=568x320
 *      npm run render:ui-gallery -- --match=dialogs/ --size=medium
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { UiSize } from '../src/core/Settings.js';
import { loadSprites } from '../src/core/SpriteLoader.js';
import { UiRoot, type HitRegion } from '../src/ui/core/UiRoot.js';
import { MOUSE_POINTER_ID, PRIMARY_BUTTON } from '../src/ui/core/pointer.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';
import type { Density } from '../src/ui/theme/tokens.js';
import { GalleryModel, type GallerySheet } from '../src/dev/uiGallery/model.js';
import { createUiGallery } from '../src/dev/uiGallery/screens.js';
import { DIALOG_FIXTURES } from '../src/dev/uiGallery/dialogs.js';
import type { DialogFixture } from '../src/dev/uiGallery/dialogs/fixture.js';
import { INVENTORY_FIXTURES } from '../src/dev/uiGallery/inventory.js';
import { SHOP_FIXTURES } from '../src/dev/uiGallery/shop.js';
import { CONSTRUCTION_FIXTURES } from '../src/dev/uiGallery/construction.js';
import { PAUSE_FIXTURES } from '../src/dev/uiGallery/pause.js';
import { HUD_FIXTURES } from '../src/dev/uiGallery/hud.js';

interface ReviewViewport {
  readonly w: number;
  readonly h: number;
  /** Phone-sized viewports are rendered as a phone would draw them: touch targets. */
  readonly density: Density;
}

const VIEWPORTS: readonly ReviewViewport[] = [
  { w: 1440, h: 900, density: 'pointer' },
  { w: 1024, h: 640, density: 'pointer' },
  { w: 844, h: 390, density: 'touch' },
  { w: 568, h: 320, density: 'touch' },
];

const UI_SIZES: readonly UiSize[] = ['small', 'medium', 'large'];

/** Long enough for every open, hover and tab tween to settle. */
const SETTLE_MS = 1000;
const FRAME_MS = 16;
const TOUCH_POINTER_ID = 1;
/** Wheel steps to land on a scroll target; one is normally enough, the rest absorb clamping. */
const MAX_SCROLL_STEPS = 4;
/** A scroll this close to its target counts as there, in UI units. */
const SCROLL_TOLERANCE = 0.5;
/** Keeps a captured cell clear of the scroll window's edge, in UI units. */
const CELL_SCROLL_MARGIN = 16;
const OUT_DIR = `${PREVIEW_DIR}/ui-gallery`;
/** Some item icons blit loaded sprites (the tomes), so the sheets are loaded first. */
const IMAGE_BASE = 'src/images/';

interface Variant {
  readonly name: string;
  readonly sheet: GallerySheet;
  /** The screen fixture a fixture sheet shows. */
  readonly fixture?: string;
  /** Pointer input applied after the screen opens, before the capture. */
  readonly interact?: (rig: Rig) => void;
}

interface Rig {
  readonly root: UiRoot;
  readonly model: GalleryModel;
  readonly canvas: Canvas;
  readonly ctx: CanvasRenderingContext2D;
  frame(): void;
  settle(): void;
  region(id: string): HitRegion | null;
  /** Like `region`, but a missing region is a broken fixture, not a skipped step. */
  need(id: string): HitRegion;
  wheel(x: number, y: number, deltaY: number): void;
  hover(region: HitRegion): void;
  tap(region: HitRegion): void;
  key(key: string): void;
}

function centre(region: HitRegion): { x: number; y: number } {
  return { x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2 };
}

function makeRig(
  viewport: ReviewViewport,
  uiSize: UiSize,
  cssHeight: number,
  sheet: GallerySheet,
  fixture: string | null = null,
): Rig {
  let clock = 0;
  const viewportInput = (): ViewportInput => ({
    cssWidth: viewport.w,
    cssHeight,
    density: viewport.density,
    uiSize,
    safeArea: NO_INSETS,
  });
  const root = new UiRoot({
    audio: null,
    viewport: viewportInput,
    now: () => clock,
    warn: () => undefined,
  });
  const model = new GalleryModel();
  model.sheet = sheet;
  model.screenFixture = fixture;
  for (const surface of createUiGallery(model, null).surfaces) root.mount(surface);
  const canvas = createCanvas(viewport.w, cssHeight);
  const ctx = asGameContext(canvas.getContext('2d'));
  const gesture = (
    kind: 'down' | 'move' | 'up' | 'cancel' | 'wheel',
    x: number,
    y: number,
    pointerId: number,
    deltaY = 0,
  ): void => {
    const scale = root.uiScale;
    root.pointer({
      kind,
      pointerId,
      source: pointerId === MOUSE_POINTER_ID ? 'mouse' : 'touch',
      x,
      y,
      cssX: x * scale,
      cssY: y * scale,
      button: PRIMARY_BUTTON,
      deltaY,
    });
  };
  const rig: Rig = {
    root,
    model,
    canvas,
    ctx,
    frame: () => {
      clock += FRAME_MS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      root.frame(ctx);
    },
    settle: () => {
      clock += SETTLE_MS;
      rig.frame();
    },
    region: (id) => root.regions().find((region) => region.id === id) ?? null,
    need: (id) => {
      const found = rig.region(id);
      if (found === null) throw new Error(`render:ui-gallery: no region "${id}" was registered`);
      return found;
    },
    wheel: (x, y, deltaY) => gesture('wheel', x, y, MOUSE_POINTER_ID, deltaY),
    hover: (region) => {
      const point = centre(region);
      gesture('move', point.x, point.y, MOUSE_POINTER_ID);
    },
    tap: (region) => {
      const point = centre(region);
      gesture('down', point.x, point.y, MOUSE_POINTER_ID);
      gesture('up', point.x, point.y, MOUSE_POINTER_ID);
    },
    key: (key) => void root.key(key, {}),
  };
  return rig;
}

/** A fixture sheet's fixtures as variants, each PNG named `<sheet>/<fixture>`. */
function fixtureVariants(sheet: GallerySheet, fixtures: readonly DialogFixture[]): Variant[] {
  return fixtures.map((fixture) => ({
    name: `${sheet}/${fixture.name}`,
    sheet,
    fixture: fixture.name,
    interact: fixture.interact,
  }));
}

/**
 * Interactions name the control they act on; where a short phone screen has
 * scrolled it out of view they name a fallback explicitly rather than skip.
 */
const SAMPLE_VARIANTS: readonly Variant[] = [
  { name: 'choice', sheet: 'choice' },
  {
    name: 'paged',
    sheet: 'paged',
    interact: (rig) => rig.tap(rig.need('paged/paged/next')),
  },
  ...fixtureVariants('inventory', INVENTORY_FIXTURES),
  ...fixtureVariants('shop', SHOP_FIXTURES),
  ...fixtureVariants('construction', CONSTRUCTION_FIXTURES),
  ...fixtureVariants('pause', PAUSE_FIXTURES),
  ...fixtureVariants('hud', HUD_FIXTURES),
  ...fixtureVariants('dialogs', DIALOG_FIXTURES),
];

function renderSample(viewport: ReviewViewport, uiSize: UiSize, variant: Variant): Canvas {
  const rig = makeRig(viewport, uiSize, viewport.h, variant.sheet, variant.fixture ?? null);
  rig.frame();
  rig.settle();
  if (variant.interact !== undefined) {
    variant.interact(rig);
    rig.frame();
    rig.settle();
  }
  return rig.canvas;
}

/** Scrolls the widget sheet to `target` (UI units, clamped by the sheet) and renders. */
function scrollSheetTo(rig: Rig, target: number): void {
  const view = rig.model.sheetView;
  for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
    const delta = target - rig.model.sheetOffset;
    if (Math.abs(delta) < SCROLL_TOLERANCE) return;
    rig.wheel(view.x + view.w / 2, view.y + view.h / 2, delta);
    rig.frame();
  }
}

/**
 * The widget sheet, page by page at the real viewport, stitched into one
 * tall image in content coordinates, with each hover/pressed/focused cell
 * captured live and composited in.
 */
function renderWidgetSheet(viewport: ReviewViewport, uiSize: UiSize): Canvas {
  const rig = makeRig(viewport, uiSize, viewport.h, 'widgets');
  rig.frame();
  rig.settle();
  const scale = rig.root.uiScale;
  const view = rig.model.sheetView;
  const contentHeight = rig.model.widgetSheetHeight;
  const maxOffset = Math.max(0, contentHeight - view.h);
  const below = viewport.h / scale - (view.y + view.h);
  const composite = createCanvas(viewport.w, Math.ceil((view.y + contentHeight + below) * scale));
  const out = composite.getContext('2d');
  const px = (units: number): number => Math.round(units * scale);
  out.drawImage(rig.canvas, 0, 0, viewport.w, px(view.y), 0, 0, viewport.w, px(view.y));

  for (let offset = 0; ; offset += view.h) {
    scrollSheetTo(rig, Math.min(offset, maxOffset));
    rig.settle();
    const actual = rig.model.sheetOffset;
    out.drawImage(
      rig.canvas,
      0,
      px(view.y),
      viewport.w,
      px(view.h),
      0,
      px(view.y + actual),
      viewport.w,
      px(view.h),
    );
    if (offset >= maxOffset) break;
  }
  out.drawImage(
    rig.canvas,
    0,
    px(view.y + view.h),
    viewport.w,
    px(below),
    0,
    px(view.y + contentHeight),
    viewport.w,
    px(below),
  );

  scrollSheetTo(rig, 0);
  const cells = rig.model.cells.map((cell) => ({ ...cell, contentY: cell.rect.y - view.y }));
  for (const cell of cells) {
    scrollSheetTo(rig, Math.min(maxOffset, Math.max(0, cell.contentY - CELL_SCROLL_MARGIN)));
    const live = rig.model.cells.find(
      (c) => c.widgetId === cell.widgetId && c.state === cell.state,
    );
    if (live === undefined) throw new Error(`render:ui-gallery: cell "${cell.widgetId}" vanished`);
    const region = rig.need(`widgets/${cell.widgetId}`);
    const point = centre(region);
    const pointer = (kind: 'down' | 'move' | 'cancel', pointerId: number): void => {
      rig.root.pointer({
        kind,
        pointerId,
        source: pointerId === MOUSE_POINTER_ID ? 'mouse' : 'touch',
        x: point.x,
        y: point.y,
        cssX: point.x * scale,
        cssY: point.y * scale,
        button: PRIMARY_BUTTON,
        deltaY: 0,
      });
    };
    switch (cell.state) {
      case 'hover':
        pointer('move', MOUSE_POINTER_ID);
        break;
      case 'pressed':
        rig.root.pointerLeft();
        pointer('down', TOUCH_POINTER_ID);
        break;
      case 'focused': {
        rig.root.pointerLeft();
        const ringSize = rig.root
          .regions()
          .filter((r) => r.surfaceId === 'widgets' && r.focusable).length;
        for (
          let press = 0;
          press < ringSize && rig.model.focusedWidget !== cell.widgetId;
          press++
        ) {
          rig.root.key('Tab');
          rig.frame();
        }
        if (rig.model.focusedWidget !== cell.widgetId) {
          throw new Error(`render:ui-gallery: Tab never reached "${cell.widgetId}"`);
        }
        break;
      }
    }
    rig.frame();
    rig.settle();
    const sx = Math.max(0, px(live.rect.x));
    const sy = Math.max(0, px(live.rect.y));
    const sw = Math.min(viewport.w - sx, px(live.rect.w));
    const sh = Math.min(viewport.h - sy, px(live.rect.h));
    out.drawImage(rig.canvas, sx, sy, sw, sh, sx, sy + px(rig.model.sheetOffset), sw, sh);
    if (cell.state === 'pressed') pointer('cancel', TOUCH_POINTER_ID);
    rig.root.pointerLeft();
  }
  return composite;
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main(): Promise<void> {
  installCanvasGlobals();
  await loadSprites(IMAGE_BASE);
  const only = argValue('only');
  const match = argValue('match');
  const onlySize = argValue('size');
  const viewportLabels = VIEWPORTS.map((viewport) => `${viewport.w}x${viewport.h}`);
  if (only !== null && !viewportLabels.includes(only)) {
    throw new Error(`render:ui-gallery: --only=${only} is not one of ${viewportLabels.join(', ')}`);
  }
  if (onlySize !== null && !UI_SIZES.some((size) => size === onlySize)) {
    throw new Error(`render:ui-gallery: --size=${onlySize} is not one of ${UI_SIZES.join(', ')}`);
  }
  let written = 0;
  for (const viewport of VIEWPORTS) {
    const label = `${viewport.w}x${viewport.h}`;
    if (only !== null && only !== label) continue;
    for (const uiSize of UI_SIZES) {
      if (onlySize !== null && onlySize !== uiSize) continue;
      const dir = `${OUT_DIR}/${label}-${uiSize}`;
      if (match === null) {
        writePreviewPng(
          `${dir}/widgets.png`,
          renderWidgetSheet(viewport, uiSize).toBuffer('image/png'),
        );
        written++;
      }
      for (const variant of SAMPLE_VARIANTS) {
        if (match !== null && !variant.name.includes(match)) continue;
        writePreviewPng(
          `${dir}/${variant.name}.png`,
          renderSample(viewport, uiSize, variant).toBuffer('image/png'),
        );
        written++;
      }
    }
  }
  if (written === 0) {
    throw new Error(`render:ui-gallery: nothing matched --match=${match ?? ''}; no PNGs written`);
  }
  console.log(`render:ui-gallery wrote ${written} PNGs under ${OUT_DIR}/`);
}

await main();
