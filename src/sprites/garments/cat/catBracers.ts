/**
 * The Riveted Bracers on the cat crawler: a band of boiled leather round each
 * foreleg just above the paw, riveted at its corners. On both forelegs,
 * unlike the bracelet, so in profile the far one shows too, deep in her
 * body's shade.
 *
 * In profile each is painted on the lower leg before the paw, so the paw's
 * fur laps over its lower edge. Head-on and from behind her forelegs end in
 * the paws under her chest, so each sits across the top of the paw, where the
 * wrist is.
 */

import type { CatLegFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { fabricFill, shadeOver, type FabricRamp } from './clothInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

/** The human's boiled leather: a warm tan well over her coat's value. */
const BOILED_LEATHER: FabricRamp = {
  shadow: '#56361f',
  base: '#a87547',
  light: '#c9976a',
  edge: '#3c2414',
};
const RIVET = '#f4f1ea';
const RIVET_RADIUS = 0.011;
/** The rivets sit this share of the band's half-width in from either end. */
const RIVET_INSET = 0.7;
const EDGE_WIDTH = 0.012;

/** The band's half-height, tile units; and how far above the paw's centre it sits on a profile leg. */
const BAND_HALF_HEIGHT = 0.045;
const ABOVE_PAW = 0.1;
/** On a leg drawn short — a paw raised to her face — the band stays this far down it. */
const HIGHEST_ON_LEG = 0.5;
/** The band stands proud of the fur by this share of the leg's half-width. */
const BAND_SPREAD = 1.3;
/** Head-on, how far up the paw the band sits as a share of its half-height, and its reach across it. */
const WRIST_ON_PAW = 0.8;
const PAW_BAND_SPREAD = 0.72;
/** A leg darker than this is in the body's shade, where the rivets catch no light. */
const LIT_SHADE_LIMIT = 0.1;

function drawBand(ctx: Ctx, y: number, half: number, shade: number): void {
  const top = y - BAND_HALF_HEIGHT;
  const bottom = y + BAND_HALF_HEIGHT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-half, top, half * 2, bottom - top);
  ctx.fillStyle = fabricFill(ctx, BOILED_LEATHER, { x: -half, y: top }, { x: half, y: bottom });
  ctx.fill();
  ctx.strokeStyle = BOILED_LEATHER.edge;
  ctx.lineWidth = EDGE_WIDTH;
  ctx.stroke();
  shadeOver(ctx, shade, -half, top, half * 2, bottom - top);
  if (shade < LIT_SHADE_LIMIT) {
    ctx.fillStyle = RIVET;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * half * RIVET_INSET, y, RIVET_RADIUS, 0, FULL_TURN);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintOnPaw(ctx: Ctx, frame: CatLegFrame): void {
  if (frame.piece !== 'paw') return;
  drawBand(ctx, -frame.radiusY * WRIST_ON_PAW, frame.radiusX * PAW_BAND_SPREAD, frame.shade);
}

function paintOnLowerLeg(ctx: Ctx, frame: CatLegFrame): void {
  if (frame.piece !== 'lower') return;
  const y = Math.max(frame.length - ABOVE_PAW, frame.length * HIGHEST_ON_LEG);
  drawBand(ctx, y, frame.halfWidth * BAND_SPREAD, frame.shade);
}

export const CAT_BRACERS = defineGarment({
  id: 'cat_bracers',
  name: 'Riveted Bracers',
  wearer: 'cat',
  material: 'leather',
  layer: 'outer',
  region: ['foreleg'],
  paint: {
    foreleg: withViewFallback(
      { front: paintOnPaw, side: paintOnLowerLeg, back: paintOnPaw },
      CAT_VIEW_FALLBACK,
    ),
  },
});
