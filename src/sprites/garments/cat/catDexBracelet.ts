/**
 * The Bracelet of +2 DEX on Donut: a gold band with a green stone, round her
 * right foreleg just above the paw. It stays on her right leg whichever way
 * she faces: on the near leg facing east, on the screen-left leg head-on.
 * Facing west her right foreleg is the far one, deep in the body's shade,
 * where the band read as a speck of dirt, so there it is not painted.
 *
 * In profile it is painted on the lower leg before the paw, so the paw's fur
 * laps over its lower edge. Head-on and from behind her forelegs show only as
 * paws, so it is painted across the top of the paw; from behind the stone is
 * on the far side of the leg and only the band shows.
 */

import type { CatLegFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { GOLD, metalFill, paintGlint } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const STONE = '#2fa84f';
const STONE_DEEP = '#0f4a22';
const SHADE_INK = '#0d0a08';

/** How far above the paw's centre the band sits, along the leg: just clear of the paw's top. */
const ABOVE_PAW = 0.09;
/** The band stands proud of the fur by this share of the leg's half-width. */
const BAND_SPREAD = 1.45;
const BAND_HALF_HEIGHT = 0.038;
/** The band wraps round the leg, so its lower edge bows toward the camera. */
const BAND_CURVE = 0.012;
const STONE_RADIUS = 0.02;
const GLINT_REACH = 0.03;
/** On a leg drawn short — a paw raised to her face — the band stays this far down it. */
const HIGHEST_ON_LEG = 0.55;
/** A leg darker than this is in the body's shade, where the band catches no light. */
const LIT_SHADE_LIMIT = 0.1;
/**
 * A leg this deep in the body's shade is her far leg in profile: a band on
 * it showed as a speck of dirt, so it is left unpainted there.
 */
const HIDDEN_SHADE = 0.25;
/** Head-on, how far up the paw the band sits, as a share of the paw's half-height, and its reach across it. */
const WRIST_ON_PAW = 0.82;
const PAW_BAND_SPREAD = 0.95;
const STONE_LIGHT_OFFSET = 0.25;
const STONE_LIGHT_SHARE = 0.65;
const GLINT_ACROSS = 0.55;
const GLINT_UP = 0.3;
/** The band's edges in its own shadow, so it parts from the fur above and below it. */
const EDGE_WIDTH = 0.012;

function drawBand(ctx: Ctx, y: number, half: number, shade: number, stone: boolean): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-half, y - BAND_HALF_HEIGHT);
  ctx.quadraticCurveTo(0, y - BAND_HALF_HEIGHT + BAND_CURVE * 2, half, y - BAND_HALF_HEIGHT);
  ctx.lineTo(half, y + BAND_HALF_HEIGHT);
  ctx.quadraticCurveTo(0, y + BAND_HALF_HEIGHT + BAND_CURVE * 2, -half, y + BAND_HALF_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = metalFill(ctx, GOLD, -half, y - BAND_HALF_HEIGHT, half, y + BAND_HALF_HEIGHT);
  ctx.fill();
  ctx.strokeStyle = GOLD.shadow;
  ctx.lineWidth = EDGE_WIDTH;
  ctx.stroke();
  if (shade > 0) {
    ctx.globalAlpha = shade;
    ctx.fillStyle = SHADE_INK;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (stone) {
    const stoneY = y + BAND_CURVE;
    ctx.beginPath();
    ctx.arc(0, stoneY, STONE_RADIUS, 0, FULL_TURN);
    ctx.fillStyle = STONE_DEEP;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      -STONE_RADIUS * STONE_LIGHT_OFFSET,
      stoneY - STONE_RADIUS * STONE_LIGHT_OFFSET,
      STONE_RADIUS * STONE_LIGHT_SHARE,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = STONE;
    ctx.fill();
  }
  if (shade < LIT_SHADE_LIMIT) {
    paintGlint(ctx, GOLD, -half * GLINT_ACROSS, y - BAND_HALF_HEIGHT * GLINT_UP, GLINT_REACH);
  }
  ctx.restore();
}

/**
 * Head-on and from behind her foreleg is no more than the paw under her
 * chest, so the band sits across the top of the paw, where the wrist is.
 */
function paintOnPaw(stone: boolean) {
  return (ctx: Ctx, frame: CatLegFrame): void => {
    if (frame.side !== 'right' || frame.piece !== 'paw') return;
    drawBand(
      ctx,
      -frame.radiusY * WRIST_ON_PAW,
      frame.radiusX * PAW_BAND_SPREAD,
      frame.shade,
      stone,
    );
  };
}

/** In profile the band sits on the lower leg, just clear of the paw. */
function paintOnLowerLeg(ctx: Ctx, frame: CatLegFrame): void {
  if (frame.side !== 'right' || frame.piece !== 'lower') return;
  if (frame.shade >= HIDDEN_SHADE) return;
  const y = Math.max(frame.length - ABOVE_PAW, frame.length * HIGHEST_ON_LEG);
  drawBand(ctx, y, frame.halfWidth * BAND_SPREAD, frame.shade, true);
}

export const CAT_DEX_BRACELET = defineGarment({
  id: 'cat_dex_bracelet',
  name: 'Bracelet of +2 DEX',
  wearer: 'cat',
  material: 'jewelry',
  layer: 'outer',
  region: ['foreleg'],
  paint: {
    foreleg: withViewFallback(
      { front: paintOnPaw(true), side: paintOnLowerLeg, back: paintOnPaw(false) },
      CAT_VIEW_FALLBACK,
    ),
  },
});
