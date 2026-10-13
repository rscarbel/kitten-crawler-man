/**
 * Renders every slot symbol, sharp and smeared, at reel size and large, into
 * one sheet for review: `npm run render:slot-symbols` writes
 * `preview/slots/symbols.png`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from 'canvas';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { SLOT_SYMBOLS } from '../src/systems/casino/slots/slotSymbols.js';
import { bakedSymbol, paintSlotSymbol } from '../src/ui/casino/slots/slotSymbols.js';
import { slotsInk } from '../src/ui/theme/slotsInk.js';

installCanvasGlobals();

const LARGE = 220;
const SMALL = 110;
const GAP = 12;
const OUT_DIR = 'preview/slots';
/** Rows: the large painting, then the sharp and smeared bakes. */
const SMALL_ROWS = 2;
const ROW_GAPS = 4;
const BLUR_ROW_GAPS = 3;

const width = SLOT_SYMBOLS.length * (LARGE + GAP) + GAP;
const height = LARGE + SMALL * SMALL_ROWS + GAP * ROW_GAPS;
const canvas = createCanvas(width, height);
const ctx = asGameContext(canvas.getContext('2d'));
ctx.fillStyle = slotsInk.reel.face;
ctx.fillRect(0, 0, width, height);
SLOT_SYMBOLS.forEach((symbol, index) => {
  const x = GAP + index * (LARGE + GAP);
  paintSlotSymbol(ctx, symbol, x, GAP, LARGE, LARGE);
  const sharp = bakedSymbol(symbol, 'sharp', SMALL, SMALL);
  const blur = bakedSymbol(symbol, 'blur', SMALL, SMALL);
  if (sharp !== null) ctx.drawImage(sharp, x, LARGE + GAP * 2, SMALL, SMALL);
  if (blur !== null) ctx.drawImage(blur, x, LARGE + SMALL + GAP * BLUR_ROW_GAPS, SMALL, SMALL);
});
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/symbols.png`, canvas.toBuffer('image/png'));
console.log(`render:slot-symbols wrote ${OUT_DIR}/symbols.png`);
