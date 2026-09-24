/**
 * Bakes every Briar Hollow item icon at 24/32/48 px into `preview/village-icons.png`
 * and checks, per icon per size, that it painted something, that nothing
 * painted outside its own cell, and that it fills its cell the way an
 * existing inventory icon does.
 *
 * Every icon clips itself to its `x,y,size,size` square before drawing (see
 * each `draw*Icon` dispatcher in `src/ui/icons/`), so this gate's "outside the
 * cell" check is really a check that the clip itself is being applied —
 * a painter that forgot to clip, or that clips the wrong rectangle, is what
 * this catches.
 *
 * The preview's first row draws two existing inventory icons (health potion,
 * goblin dynamite) through the real `drawItemIcon` dispatcher, as a visual
 * ruler for how much of the cell a properly scaled icon fills.
 *
 *   npm run gates:village-icons
 */

import { pathToFileURL } from 'node:url';

import { createCanvas } from 'canvas';

import { asGameContext, gameContext } from './nodeGameContext.js';
import { writePreviewPng } from './previewOut.js';
import {
  drawResourceIcon,
  RESOURCE_ICON_ID_LIST,
  type ResourceIconId,
} from '../src/ui/icons/resourceIcons.js';
import { drawToolIcon, TOOL_ICON_ID_LIST, type ToolIconId } from '../src/ui/icons/toolIcons.js';
import { drawFoodIcon, FOOD_ICON_ID_LIST, type FoodIconId } from '../src/ui/icons/foodIcons.js';
import { drawKitIcon, KIT_ICON_ID_LIST, type KitIconId } from '../src/ui/icons/kitIcons.js';
import { drawItemIcon } from '../src/ui/InventoryPanel.js';
import type { InventoryItem } from '../src/core/ItemDefs.js';

type Draw = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;

interface IconSpec {
  readonly label: string;
  readonly draw: Draw;
  /** Reference icons (drawn from the real inventory dispatcher) are shown for scale, not gated. */
  readonly reference?: true;
}

const RESOURCE_ICONS: readonly IconSpec[] = RESOURCE_ICON_ID_LIST.map((id: ResourceIconId) => ({
  label: `resource:${id}`,
  draw: (ctx, x, y, size) => drawResourceIcon(ctx, id, x, y, size),
}));
const TOOL_ICONS: readonly IconSpec[] = TOOL_ICON_ID_LIST.map((id: ToolIconId) => ({
  label: `tool:${id}`,
  draw: (ctx, x, y, size) => drawToolIcon(ctx, id, x, y, size),
}));
const FOOD_ICONS: readonly IconSpec[] = FOOD_ICON_ID_LIST.map((id: FoodIconId) => ({
  label: `food:${id}`,
  draw: (ctx, x, y, size) => drawFoodIcon(ctx, id, x, y, size),
}));
const KIT_ICONS: readonly IconSpec[] = KIT_ICON_ID_LIST.map((id: KitIconId) => ({
  label: `kit:${id}`,
  draw: (ctx, x, y, size) => drawKitIcon(ctx, id, x, y, size),
}));

const REFERENCE_HEALTH_POTION: InventoryItem = {
  id: 'health_potion',
  name: 'Health Potion',
  quantity: 1,
  stackable: true,
  canHotlist: true,
};
const REFERENCE_GOBLIN_DYNAMITE: InventoryItem = {
  id: 'goblin_dynamite',
  name: 'Goblin Dynamite',
  quantity: 1,
  stackable: true,
  canHotlist: true,
};
const REFERENCE_ICONS: readonly IconSpec[] = [
  {
    label: 'reference:health_potion',
    draw: (ctx, x, y, size) => drawItemIcon(ctx, REFERENCE_HEALTH_POTION, x, y, size),
    reference: true,
  },
  {
    label: 'reference:goblin_dynamite',
    draw: (ctx, x, y, size) => drawItemIcon(ctx, REFERENCE_GOBLIN_DYNAMITE, x, y, size),
    reference: true,
  },
];

const NEW_ICONS: readonly IconSpec[] = [
  ...RESOURCE_ICONS,
  ...TOOL_ICONS,
  ...FOOD_ICONS,
  ...KIT_ICONS,
];
const ALL_ICONS: readonly IconSpec[] = [...REFERENCE_ICONS, ...NEW_ICONS];

/** Slot size (hotbar), inventory-grid size, and the Construction menu's larger row size. */
const SIZE_SLOT = 24;
const SIZE_INVENTORY_GRID = 32;
const SIZE_MENU_ROW = 48;
const SIZES = [SIZE_SLOT, SIZE_INVENTORY_GRID, SIZE_MENU_ROW] as const;

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Above this a pixel counts as painted, below it as background noise or AA fringe. */
const SOLID_ALPHA = 40;
/** An icon must paint at least this fraction of its square to count as non-empty. */
const MIN_OPAQUE_FRACTION = 0.03;
/** A pixel above this alpha outside the icon's square counts as a bleed. */
const BLEED_ALPHA = 8;
/** Margin around the icon's square when checking for paint outside its cell. */
const CELL_PAD = 4;
/**
 * An icon's opaque bounding box, along its longer axis, must cover at least
 * this fraction of the cell. `health_potion` and `goblin_dynamite` — both
 * drawn through the real `drawItemIcon` dispatcher — measure 0.71 at every
 * size in this file's own reference row, so 0.6 leaves room below an existing
 * icon's fill without tolerating the "small smudge in the corner" a
 * badly-scaled painter produces.
 */
const MIN_BBOX_FRACTION = 0.6;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function paint(
  spec: IconSpec,
  size: number,
  offsetX: number,
  offsetY: number,
  canvasSize: number,
): Pixels {
  const ctx = gameContext(canvasSize, canvasSize);
  spec.draw(ctx, offsetX, offsetY, size);
  const image = ctx.getImageData(0, 0, canvasSize, canvasSize);
  return { width: canvasSize, height: canvasSize, data: image.data };
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  return pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_OFFSET];
}

function gateNonEmpty(): void {
  for (const spec of ALL_ICONS) {
    for (const size of SIZES) {
      const pixels = paint(spec, size, 0, 0, size);
      let opaqueCount = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (alphaAt(pixels, x, y) >= SOLID_ALPHA) opaqueCount++;
        }
      }
      const minOpaque = Math.ceil(size * size * MIN_OPAQUE_FRACTION);
      if (opaqueCount < minOpaque) {
        fail(
          'G1-non-empty',
          `${spec.label}@${size}px painted only ${opaqueCount} opaque px, need at least ${minOpaque}`,
        );
      }
    }
  }
}

function gateNoBleed(): void {
  for (const spec of ALL_ICONS) {
    for (const size of SIZES) {
      const canvasSize = size + CELL_PAD * 2;
      const pixels = paint(spec, size, CELL_PAD, CELL_PAD, canvasSize);
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const insideCell =
            x >= CELL_PAD && x < CELL_PAD + size && y >= CELL_PAD && y < CELL_PAD + size;
          if (insideCell) continue;
          if (alphaAt(pixels, x, y) > BLEED_ALPHA) {
            fail(
              'G2-no-bleed',
              `${spec.label}@${size}px painted outside its cell at (${x - CELL_PAD}, ${y - CELL_PAD})`,
            );
          }
        }
      }
    }
  }
}

function gateMinFill(): void {
  for (const spec of NEW_ICONS) {
    for (const size of SIZES) {
      const pixels = paint(spec, size, 0, 0, size);
      let minX: number = size;
      let maxX = -1;
      let minY: number = size;
      let maxY = -1;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (alphaAt(pixels, x, y) < SOLID_ALPHA) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) continue; // already reported by gateNonEmpty

      const bboxFraction = Math.max(maxX - minX + 1, maxY - minY + 1) / size;
      if (bboxFraction < MIN_BBOX_FRACTION) {
        fail(
          'G3-min-fill',
          `${spec.label}@${size}px bounding box covers ${bboxFraction.toFixed(2)} of the cell, need at least ${MIN_BBOX_FRACTION}`,
        );
      }
    }
  }
}

/** Runs every gate and returns one message per failure. */
export function villageIconGateFailures(): string[] {
  failures.length = 0;
  gateNonEmpty();
  gateNoBleed();
  gateMinFill();
  return [...failures];
}

const PREVIEW_CELL_PAD = 10;
const PREVIEW_LABEL_WIDTH = 170;
const PREVIEW_LABEL_FONT = '12px monospace';
const PREVIEW_BACKGROUND = '#20242c';
const PREVIEW_LABEL_COLOR = '#e8ecf2';
const PREVIEW_CELL_OUTLINE = 'rgba(255,255,255,0.15)';

function bakePreview(): string {
  const maxSize = SIZES[SIZES.length - 1];
  const rowHeight = maxSize + PREVIEW_CELL_PAD * 2;
  const columnWidth = maxSize + PREVIEW_CELL_PAD * 2;
  const width = PREVIEW_LABEL_WIDTH + columnWidth * SIZES.length;
  const height = rowHeight * ALL_ICONS.length;

  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = PREVIEW_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  ALL_ICONS.forEach((spec, row) => {
    const rowTop = row * rowHeight;
    ctx.fillStyle = PREVIEW_LABEL_COLOR;
    ctx.font = PREVIEW_LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.label, PREVIEW_CELL_PAD, rowTop + rowHeight / 2);

    SIZES.forEach((size, column) => {
      const cellLeft = PREVIEW_LABEL_WIDTH + column * columnWidth;
      const iconX = cellLeft + (columnWidth - size) / 2;
      const iconY = rowTop + (rowHeight - size) / 2;
      ctx.strokeStyle = PREVIEW_CELL_OUTLINE;
      ctx.strokeRect(iconX, iconY, size, size);
      spec.draw(ctx, iconX, iconY, size);
    });
  });

  return writePreviewPng('preview/village-icons.png', canvas.toBuffer('image/png'));
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const outPath = bakePreview();
  console.log(`Baked ${outPath}`);
  const results = villageIconGateFailures();
  if (results.length === 0) {
    console.log('  ok   village-icons');
  } else {
    for (const failure of results) console.error(`  FAIL village-icons: ${failure}`);
    process.exitCode = 1;
  }
}
