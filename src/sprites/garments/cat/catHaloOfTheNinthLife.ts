/**
 * The Halo of the Ninth Life on the cat crawler: a thin gold ring floating a
 * whisker above her ears, seen in perspective as a flat ellipse, with a faint
 * glow round it. It never touches her: the clear gap between ring and head is
 * the whole read, so the ring sits between her ear tips, above her skull, in
 * every view.
 */

import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { type HatSeat, hatPainters } from './headwear';
import { GOLD, paintGlint } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

/** How far above the top of her skull the ring floats, and its size seen head-on. */
const FLOAT_HEIGHT = 0.14;
const RING_HALF_WIDTH = 0.16;
const RING_HALF_DEPTH = 0.045;
const RING_WIDTH = 0.03;
/** The glow is a wide, faint stroke under the ring. */
const GLOW = 'rgba(255,236,150,0.32)';
const GLOW_WIDTH = 0.075;
const GLINT_REACH = 0.035;
/** The glint sits on the lit front-left of the ring. */
const GLINT_ANGLE = HALF_TURN * 0.7;
/** In profile the ring is seen from the same height, over the middle of her skull. */
const PROFILE_HALF_WIDTH = 0.14;
const PROFILE_BACK = 0.02;
const TURN_SLIDE = 0.03;

function paintHalo(ctx: Ctx, seat: HatSeat): void {
  const profile = seat.view === 'side';
  const cx = profile ? seat.cx - PROFILE_BACK : seat.cx;
  const cy = seat.skullTop - FLOAT_HEIGHT;
  const rx = profile ? PROFILE_HALF_WIDTH : RING_HALF_WIDTH;

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, RING_HALF_DEPTH, 0, 0, FULL_TURN);
  ctx.strokeStyle = GLOW;
  ctx.lineWidth = GLOW_WIDTH;
  ctx.stroke();

  // The far half of the ring is in its own shadow; the near half catches the light.
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, RING_HALF_DEPTH, 0, HALF_TURN, FULL_TURN);
  ctx.strokeStyle = GOLD.base;
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, RING_HALF_DEPTH, 0, 0, HALF_TURN);
  ctx.strokeStyle = GOLD.light;
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();

  if (seat.view === 'back') return;
  paintGlint(
    ctx,
    GOLD,
    cx + Math.cos(GLINT_ANGLE) * rx,
    cy + Math.sin(GLINT_ANGLE) * RING_HALF_DEPTH,
    GLINT_REACH,
  );
}

export const CAT_HALO_OF_THE_NINTH_LIFE = defineGarment({
  id: 'cat_halo_of_the_ninth_life',
  name: 'Halo of the Ninth Life',
  wearer: 'cat',
  material: 'jewelry',
  layer: 'overcoat',
  region: ['head'],
  paint: {
    head: withViewFallback(
      hatPainters({ paint: paintHalo, turnSlide: TURN_SLIDE, profileTilt: 0 }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
