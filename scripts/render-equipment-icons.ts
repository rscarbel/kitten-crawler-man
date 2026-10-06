#!/usr/bin/env tsx
/**
 * Review sheet for the worn-equipment, tool and Scroll of Confusing Fog icons,
 * drawn through the real `drawItemIcon` dispatcher onto a slot-coloured cell.
 *
 * Each row is one item at the sizes a player actually meets it — the hotbar's
 * art box at a device pixel ratio of 1 and of 2, the smallest size any gate
 * paints — then a large native paint, and finally the 1x paint blown up with
 * nearest-neighbour sampling, so what the player sees pixel for pixel can be
 * judged next to what the painter intended.
 *
 *   npm run render:equipment-icons [-- --out=<directory>]   (default preview/equipment-icons/)
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { writePreviewPng } from './previewOut.js';
import { ITEM_DEF, type ItemId, type InventoryItem } from '../src/core/ItemDefs.js';
import { drawItemIcon } from '../src/ui/icons/drawItemIcon.js';

const FAMILIES: Readonly<Record<string, readonly ItemId[]>> = {
  head: ['issue_kettle_helm', 'enchanted_crown_sepsis_whore', 'slate_butterfly_talisman'],
  torso: ['padded_gambeson', 'trollskin_shirt', 'nightgaunt_cloak', 'fae_scale_crupper'],
  hands: ['riveted_bracers', 'bracelet_of_dex', 'grull_war_gauntlet'],
  legsFeet: [
    'enchanted_bigboi_boxers',
    'shade_gnoll_kneepads',
    'marching_boots',
    'splatter_skunk_toe_ring',
  ],
  axes: [
    'basic_axe',
    'hardened_axe',
    'lumberjacks_axe',
    'ratkin_forge_axe',
    'deepwood_cleaver',
    'graveyards_bane',
  ],
  picks: [
    'basic_pickaxe',
    'hardened_pickaxe',
    'quarrymans_pick',
    'ratkin_forge_pick',
    'stonebreaker',
    'worldscar_pick',
  ],
  scroll: ['scroll_of_confusing_fog'],
};

/** The hotbar slot (52 px) less its 14% art inset on each side. */
const SIZE_HOTBAR_ART = 38;
const SIZE_HOTBAR_ART_RETINA = SIZE_HOTBAR_ART * 2;
const SIZE_SMALLEST_GATED = 24;
const SIZE_NATIVE_LARGE = 152;
const NEAREST_ZOOM = 4;
const SIZES = [SIZE_SMALLEST_GATED, SIZE_HOTBAR_ART, SIZE_HOTBAR_ART_RETINA, SIZE_NATIVE_LARGE];

const CELL_PAD = 8;
const LABEL_WIDTH = 210;
const LABEL_FONT = '13px monospace';
const PAGE_BACKGROUND = '#121418';
const SLOT_BACKGROUND = '#262b35';
const LABEL_COLOR = '#e8ecf2';

function outDirectory(): string {
  const flag = process.argv.find((arg) => arg.startsWith('--out='));
  return flag?.slice('--out='.length) ?? 'preview/equipment-icons';
}

function itemOf(id: ItemId): InventoryItem {
  return { ...ITEM_DEF[id], quantity: 1 };
}

const zoomedSize = SIZE_HOTBAR_ART * NEAREST_ZOOM;
const rowHeight = Math.max(SIZE_NATIVE_LARGE, zoomedSize) + CELL_PAD * 2;
const columnWidths = [...SIZES, zoomedSize].map((size) => size + CELL_PAD * 2);
const width = LABEL_WIDTH + columnWidths.reduce((sum, w) => sum + w, 0);

function renderFamily(items: readonly ItemId[]): Buffer {
  const height = rowHeight * items.length;
  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = PAGE_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  const small = createCanvas(SIZE_HOTBAR_ART, SIZE_HOTBAR_ART);
  const smallCtx = asGameContext(small.getContext('2d'));

  items.forEach((id, row) => {
    const rowTop = row * rowHeight;
    const item = itemOf(id);
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText(id, CELL_PAD, rowTop + rowHeight / 2);

    let cellLeft = LABEL_WIDTH;
    SIZES.forEach((size, column) => {
      const iconX = cellLeft + CELL_PAD;
      const iconY = rowTop + (rowHeight - size) / 2;
      ctx.fillStyle = SLOT_BACKGROUND;
      ctx.fillRect(iconX, iconY, size, size);
      drawItemIcon(ctx, { x: iconX, y: iconY, w: size, h: size }, item);
      cellLeft += columnWidths[column];
    });

    smallCtx.fillStyle = SLOT_BACKGROUND;
    smallCtx.fillRect(0, 0, SIZE_HOTBAR_ART, SIZE_HOTBAR_ART);
    drawItemIcon(smallCtx, { x: 0, y: 0, w: SIZE_HOTBAR_ART, h: SIZE_HOTBAR_ART }, item);
    ctx.imageSmoothingEnabled = false;
    const zoomTop = rowTop + (rowHeight - zoomedSize) / 2;
    ctx.drawImage(smallCtx.canvas, cellLeft + CELL_PAD, zoomTop, zoomedSize, zoomedSize);
    ctx.imageSmoothingEnabled = true;
  });

  return canvas.toBuffer('image/png');
}

const outDir = outDirectory();
for (const [family, items] of Object.entries(FAMILIES)) {
  console.log(`Baked ${writePreviewPng(`${outDir}/${family}.png`, renderFamily(items))}`);
}
