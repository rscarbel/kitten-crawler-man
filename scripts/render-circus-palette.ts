/**
 * Swatch review for `CIRCUS_RAMPS`: one sheet that lays the circus ramps
 * beside Over City's `TOWN_RAMPS`, Briar Hollow's palette constants and the
 * real grass and dirt ground the circus stands on, so a reviewer can judge
 * whether the circus sits in the same value/saturation world as the town.
 *
 *   npx tsx scripts/render-circus-palette.ts [--out=preview/circus-palette.png]
 *
 * Each ramp row shows its four stops, a shadow→light gradient, and — for the
 * circus — a striped canvas swatch lit from the town sun, so the stripe pairs
 * the tents actually use are judged as cloth, not as chips.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { getMaterial, paintPatch } from '../src/map/tilegen/materials.js';
import {
  CIRCUS_RAMPS,
  TOWN_RAMPS,
  sampleRamp,
  type Ramp,
  type RGB,
  type CircusRampId,
} from '../src/sprites/art/town/townPalette.js';
import {
  WOOD,
  LOG,
  STONE,
  MOSS,
  BRASS,
  IRON,
  CLOTH,
  FLAME,
} from '../src/sprites/art/villageArt.js';

// ── layout ───────────────────────────────────────────────────────────────────

const DEFAULT_OUT = `${PREVIEW_DIR}/circus-palette.png`;
const COLUMN_W = 640;
const COLUMN_COUNT = 3;
const MARGIN = 20;
const ROW_H = 44;
const HEADER_H = 32;
const LABEL_W = 150;
const CHIP_W = 40;
const CHIP_GAP = 4;
const GRADIENT_W = 120;
const CLOTH_W = 180;
const SECTION_GAP = 16;
const GROUND_SWATCH_H = 140;
const GRADIENT_STEPS = 60;
const SEED = 20260929;
const STOPS_PER_RAMP = 4;

const BACKGROUND = '#26231f';
const LABEL_COLOUR = '#d8d0c0';
const LABEL_FONT = '13px sans-serif';
const HEADER_FONT = 'bold 16px sans-serif';

/** Baseline drop that visually centres 13-16 px text in its band. */
const TEXT_BASELINE_NUDGE = 5;

const HEX_BASE = 16;
const HEX_BYTE_MASK = 0xff;
const HEX_GREEN_SHIFT = 8;
const HEX_RED_SHIFT = 16;

function hexRgb(value: string): RGB {
  const n = Number.parseInt(value.replace('#', ''), HEX_BASE);
  return [
    (n >> HEX_RED_SHIFT) & HEX_BYTE_MASK,
    (n >> HEX_GREEN_SHIFT) & HEX_BYTE_MASK,
    n & HEX_BYTE_MASK,
  ];
}

function css(colour: RGB): string {
  return `rgb(${Math.round(colour[0])},${Math.round(colour[1])},${Math.round(colour[2])})`;
}

// ── rows ─────────────────────────────────────────────────────────────────────

interface SwatchRow {
  readonly label: string;
  readonly stops: readonly RGB[];
  /** A ramp enables the gradient bar; hex groups without one show chips only. */
  readonly ramp?: Ramp;
  /** The paired stripe ramp for a canvas swatch, circus only. */
  readonly stripe?: readonly [Ramp, Ramp];
}

interface Section {
  readonly title: string;
  readonly rows: readonly SwatchRow[];
}

function rampRow(label: string, ramp: Ramp, stripe?: readonly [Ramp, Ramp]): SwatchRow {
  return { label, stops: [ramp.shadow, ramp.mid, ramp.light, ramp.accent], ramp, stripe };
}

/** The stripe pairings the tents and drapes are painted with; unlisted ramps show no cloth. */
const CIRCUS_STRIPE_PARTNER: Partial<Record<CircusRampId, CircusRampId>> = {
  circus_blood: 'circus_bone',
  circus_navy: 'circus_bone',
  circus_bruise: 'circus_backstage',
  circus_backstage: 'circus_bruise',
};

function circusSection(): Section {
  const rows = Object.entries(CIRCUS_RAMPS).map(([id, ramp]) => {
    const partnerId = Object.entries(CIRCUS_STRIPE_PARTNER).find(([key]) => key === id)?.[1];
    const stripe = partnerId === undefined ? undefined : ([ramp, CIRCUS_RAMPS[partnerId]] as const);
    return rampRow(id, ramp, stripe);
  });
  return { title: 'CIRCUS_RAMPS', rows };
}

function townSection(): Section {
  return {
    title: 'TOWN_RAMPS (Over City)',
    rows: Object.entries(TOWN_RAMPS).map(([id, ramp]) => rampRow(id, ramp)),
  };
}

type HexGroup = Readonly<Record<string, string>>;

function hexRow(label: string, group: HexGroup): SwatchRow {
  return { label, stops: Object.values(group).map(hexRgb) };
}

function briarSection(): Section {
  const clothRows = Object.entries(CLOTH).map(([name, group]) => hexRow(`CLOTH.${name}`, group));
  return {
    title: 'Briar Hollow (villageArt)',
    rows: [
      hexRow('WOOD', WOOD),
      hexRow('LOG', LOG),
      hexRow('STONE', STONE),
      hexRow('MOSS', MOSS),
      hexRow('BRASS', BRASS),
      hexRow('IRON', IRON),
      ...clothRows,
      hexRow('FLAME', FLAME),
    ],
  };
}

// ── painters ─────────────────────────────────────────────────────────────────

const STRIPE_COUNT = 6;
/** Upper-left sun, matching the town light direction's sign. */
const CLOTH_LIGHT_TOP_T = 0.78;
const CLOTH_LIGHT_BOTTOM_T = 0.28;
const CLOTH_SCANLINE_STEP = 2;
/** How much brighter the leftmost stripe reads than the rightmost, from the sun on the left. */
const CLOTH_LEFT_LIFT = 0.1;

function paintStripedCloth(
  ctx: CanvasRenderingContext2D,
  pair: readonly [Ramp, Ramp],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const stripeW = w / STRIPE_COUNT;
  for (let row = 0; row < h; row += CLOTH_SCANLINE_STEP) {
    const lightT = CLOTH_LIGHT_TOP_T + (CLOTH_LIGHT_BOTTOM_T - CLOTH_LIGHT_TOP_T) * (row / h);
    for (let stripe = 0; stripe < STRIPE_COUNT; stripe++) {
      const ramp = stripe % 2 === 0 ? pair[0] : pair[1];
      const leftwardLift = (1 - stripe / STRIPE_COUNT) * CLOTH_LEFT_LIFT;
      ctx.fillStyle = css(sampleRamp(ramp, lightT + leftwardLift));
      ctx.fillRect(x + stripe * stripeW, y + row, Math.ceil(stripeW), CLOTH_SCANLINE_STEP);
    }
  }
}

function paintRow(ctx: CanvasRenderingContext2D, row: SwatchRow, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOUR;
  ctx.font = LABEL_FONT;
  ctx.fillText(row.label, x, y + ROW_H / 2 + TEXT_BASELINE_NUDGE);
  let cursor = x + LABEL_W;
  const chipH = ROW_H - CHIP_GAP * 2;
  const maxChips =
    row.ramp === undefined ? (COLUMN_W - LABEL_W) / (CHIP_W + CHIP_GAP) : STOPS_PER_RAMP;
  for (const stop of row.stops.slice(0, Math.floor(maxChips))) {
    ctx.fillStyle = css(stop);
    ctx.fillRect(cursor, y + CHIP_GAP, CHIP_W, chipH);
    cursor += CHIP_W + CHIP_GAP;
  }
  const ramp = row.ramp;
  if (ramp === undefined) return;
  cursor += CHIP_GAP;
  const stepW = GRADIENT_W / GRADIENT_STEPS;
  for (let step = 0; step < GRADIENT_STEPS; step++) {
    ctx.fillStyle = css(sampleRamp(ramp, step / (GRADIENT_STEPS - 1)));
    ctx.fillRect(cursor + step * stepW, y + CHIP_GAP, Math.ceil(stepW), chipH);
  }
  cursor += GRADIENT_W + CHIP_GAP * 2;
  if (row.stripe !== undefined)
    paintStripedCloth(ctx, row.stripe, cursor, y + CHIP_GAP, CLOTH_W, chipH);
}

function groundCanvas(materialId: string): Canvas {
  const patch = paintPatch(getMaterial(materialId), SEED, SEED);
  const canvas = createCanvas(patch.size, patch.size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(patch.size, patch.size);
  image.data.set(patch.toRgba());
  ctx.putImageData(image, 0, 0);
  return canvas;
}

const GROUND_MATERIALS = ['grass', 'dirt'] as const;

function paintGrounds(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOUR;
  ctx.font = HEADER_FONT;
  ctx.fillText('Ground (grass, dirt)', x, y + HEADER_H / 2 + TEXT_BASELINE_NUDGE);
  const swatchW = (COLUMN_W - MARGIN) / GROUND_MATERIALS.length;
  GROUND_MATERIALS.forEach((id, index) => {
    const swatch = groundCanvas(id);
    ctx.drawImage(swatch, x + index * swatchW, y + HEADER_H, swatchW - CHIP_GAP, GROUND_SWATCH_H);
  });
}

function sectionHeight(section: Section): number {
  return HEADER_H + section.rows.length * ROW_H;
}

function paintSection(
  ctx: CanvasRenderingContext2D,
  section: Section,
  x: number,
  y: number,
): number {
  ctx.fillStyle = LABEL_COLOUR;
  ctx.font = HEADER_FONT;
  ctx.fillText(section.title, x, y + HEADER_H / 2 + TEXT_BASELINE_NUDGE);
  section.rows.forEach((row, index) => paintRow(ctx, row, x, y + HEADER_H + index * ROW_H));
  return y + sectionHeight(section) + SECTION_GAP;
}

// ── main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const outFlag = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length);
  const circus = circusSection();
  const town = townSection();
  const briar = briarSection();
  const townColumnH = sectionHeight(town) + SECTION_GAP + HEADER_H + GROUND_SWATCH_H;
  const tallest = Math.max(sectionHeight(circus), townColumnH, sectionHeight(briar));
  const canvas = createCanvas(MARGIN + COLUMN_COUNT * (COLUMN_W + MARGIN), tallest + MARGIN * 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  paintSection(ctx, circus, MARGIN, MARGIN);
  const columnX = (index: number): number => MARGIN + index * (COLUMN_W + MARGIN);
  const townColumnX = columnX(1);
  const groundY = paintSection(ctx, town, townColumnX, MARGIN);
  paintGrounds(ctx, townColumnX, groundY);
  paintSection(ctx, briar, columnX(2), MARGIN);

  const written = writePreviewPng(outFlag ?? DEFAULT_OUT, canvas.toBuffer('image/png'));
  console.log(`circus palette sheet: ${written}`);
}

main();
