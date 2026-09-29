#!/usr/bin/env tsx
/**
 * Review harness for the 16 named residents' own figures. Each is a fixed
 * look on its species' cast (`townCastLooks.ts` / `skyfowl/cast.ts`), never
 * the street crowd's random pick — this harness is what proves that at a
 * glance, both enlarged and at true 32px beside a handful of street looks.
 *
 *   preview/residents/lineup.png   every resident, named, idle-down: large
 *                                  and at true in-game size, plus a row of
 *                                  street looks at the same in-game size
 *   preview/residents/blind.png    the same lineup, shuffled and numbered,
 *                                  with the answer key withheld until logged
 *
 *   npm run render:residents
 *   npx tsx scripts/render-residents.ts --blind
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell } from './figureSheet.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { allResidents, type ResidentDef } from '../src/systems/townResidents.js';
import { residentFigure } from '../src/creatures/residentFigures.js';
import type { CitizenFigure } from '../src/creatures/citizenFigure.js';
import { townCastOutfitFigure, townCastStateName } from '../src/sprites/art/townCastFigure.js';
import { castStateName, skyfowlCastFigure } from '../src/sprites/art/skyfowlCastFigure.js';
import { TOWN_CAST_LOOKS } from '../src/sprites/person/townCastLooks.js';
import { SKYFOWL_CIVILIAN_LOOKS } from '../src/sprites/art/skyfowl/cast.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { mulberry32, rangeInt } from '../src/sprites/person/rng.js';

const OUT_DIR = `${PREVIEW_DIR}/residents`;
const REVIEW_SCALE = 3;
const PADDING = 10;
const LABEL_HEIGHT = 16;
const BACKDROP = '#3b3b40';
const STREET_GROUND = '#7c746a';
const RESIDENT_GROUND = '#5d6440';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '12px sans-serif';
const BLIND_NUMBER_FONT = 'bold 15px sans-serif';
const BLIND_NUMBER_X = 6;
const BLIND_NUMBER_Y = 17;
const COLUMNS = 8;
/** A standing figure's height relative to its own paint size, for the card's ground box. */
const CARD_HEIGHT_SHARE = 1.4;
/** The card's own vertical padding budget: above the large cell, between it and the ground strip, and below the label. */
const CARD_VERTICAL_PADDING_COUNT = 3;
/** A handful of street looks — one civilian each of human and skyfowl, plus a second of each — for the "distinct from the crowd" comparison row. */
const STREET_COMPARISON_HUMAN_IDS: readonly string[] = ['adult_commoner', 'adult_merchant'];
const STREET_COMPARISON_SKYFOWL_IDS: readonly string[] = [
  'porter_sparrowfleck_standard',
  'merchant_hawkbrown_standard',
];

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface Card {
  readonly name: string;
  readonly cell: Canvas;
  /** In-game pixels per art pixel, so every card sits at true 32px scale regardless of its own cast's cell size. */
  readonly inGameScale: number;
  readonly isStreet: boolean;
}

function figureAndStateFor(figure: CitizenFigure): { def: FigureDef; state: string } {
  if (figure.species === 'skyfowl') {
    return { def: skyfowlCastFigure(figure.look.id), state: castStateName('idle', 'down') };
  }
  return { def: townCastOutfitFigure(figure.look), state: townCastStateName('idle', 'down') };
}

function cardFor(name: string, figure: CitizenFigure, isStreet: boolean): Card {
  const { def, state } = figureAndStateFor(figure);
  return {
    name,
    cell: bakeFigureCell(def, state, 0),
    inGameScale: TILE_SIZE / def.tileScale,
    isStreet,
  };
}

function residentCards(): Card[] {
  return allResidents().map((resident: ResidentDef) =>
    cardFor(resident.name, residentFigure(resident.id), false),
  );
}

function streetComparisonCards(): Card[] {
  const humanLookById = new Map(TOWN_CAST_LOOKS.map((look) => [look.id, look]));
  const cards: Card[] = [];
  for (const id of STREET_COMPARISON_HUMAN_IDS) {
    const look = humanLookById.get(id);
    if (look === undefined) throw new Error(`no human cast look "${id}"`);
    cards.push(cardFor(`(street) ${id}`, { species: 'human', look }, true));
  }
  const skyfowlLookById = new Map(SKYFOWL_CIVILIAN_LOOKS.map((look) => [look.id, look]));
  for (const id of STREET_COMPARISON_SKYFOWL_IDS) {
    const look = skyfowlLookById.get(id);
    if (look === undefined) throw new Error(`no skyfowl cast look "${id}"`);
    cards.push(cardFor(`(street) ${id}`, { species: 'skyfowl', look }, true));
  }
  return cards;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

/** Lays out `cards` as a numbered grid at both `REVIEW_SCALE` and true 32px, ground-anchored. */
function renderLineup(cards: readonly Card[], numbered: boolean): Canvas {
  const rows = Math.ceil(cards.length / COLUMNS);
  const largeCell = Math.max(...cards.map((c) => c.cell.width)) * REVIEW_SCALE;
  const largeCellH = Math.max(...cards.map((c) => c.cell.height)) * REVIEW_SCALE;
  const inGameCell = TILE_SIZE * CARD_HEIGHT_SHARE;
  const cardW = Math.max(largeCell, inGameCell) + PADDING * 2;
  const cardH = largeCellH + inGameCell + LABEL_HEIGHT + PADDING * CARD_VERTICAL_PADDING_COUNT;

  const canvas = createCanvas(cardW * COLUMNS, cardH * rows);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  cards.forEach((card, index) => {
    const col = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x0 = col * cardW;
    const y0 = row * cardH;

    // Large card, top.
    const lw = card.cell.width * REVIEW_SCALE;
    const lh = card.cell.height * REVIEW_SCALE;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(card.cell, x0 + (cardW - lw) / 2, y0 + PADDING, lw, lh);

    // True in-game-size card, on its own ground strip, below the large one.
    const groundY = y0 + PADDING + largeCellH + PADDING;
    ctx.fillStyle = card.isStreet ? STREET_GROUND : RESIDENT_GROUND;
    ctx.fillRect(x0 + PADDING, groundY, cardW - PADDING * 2, inGameCell);
    const gw = card.cell.width * card.inGameScale;
    const gh = card.cell.height * card.inGameScale;
    ctx.drawImage(card.cell, x0 + (cardW - gw) / 2, groundY + inGameCell - gh, gw, gh);

    const labelY = groundY + inGameCell + LABEL_HEIGHT - 2;
    label(ctx, numbered ? `${index + 1}` : card.name, x0 + cardW / 2, labelY);
    if (numbered) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = BLIND_NUMBER_FONT;
      ctx.textAlign = 'left';
      ctx.fillText(`${index + 1}`, x0 + BLIND_NUMBER_X, y0 + BLIND_NUMBER_Y);
    }
  });

  return canvas;
}

/** A Fisher-Yates shuffle on the project's own seeded PRNG, so a blind run is reproducible. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rangeInt(rng, 0, i);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

const BLIND_SHUFFLE_SEED = 20260928;

function main(): void {
  const residents = residentCards();
  const street = streetComparisonCards();
  const named = renderLineup([...residents, ...street], false);
  writePreviewPng(`${OUT_DIR}/lineup.png`, named.toBuffer('image/png'));
  console.log(
    `${OUT_DIR}/lineup.png: ${residents.length} residents + ${street.length} street looks`,
  );

  if (flag('blind')) {
    const order = shuffled(residents, BLIND_SHUFFLE_SEED);
    const blind = renderLineup(order, true);
    writePreviewPng(`${OUT_DIR}/blind.png`, blind.toBuffer('image/png'));
    console.log(`${OUT_DIR}/blind.png answer key:`);
    order.forEach((card, index) => console.log(`  ${index + 1}. ${card.name}`));
  }
}

main();
