/**
 * The Gilded Monocle on the cat crawler: a single gold-rimmed lens screwed into
 * the fur round her right eye, a fine gold chain looping from its rim down her
 * cheek. Head-on and in profile the gold ring is the read; from behind only a
 * loop of the chain shows past her cheek.
 *
 * Gold on a ginger coat sinks, so the ring carries a dark outer edge of its
 * own: on the black cat the gold carries it, on the ginger one the edge does.
 */

import type { CatHeadFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { CAT_LENS_RADIUS, lensCentres, PROFILE_LENS_SQUASH, PROFILE_LENS_TILT } from './faceWear';
import { GOLD, metalFill, paintGlint } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const FULL_TURN = Math.PI * 2;

const GLASS = 'rgba(214,236,250,0.55)';
const OUTER_EDGE = '#1c1204';

/** The rim is wider than a spectacle's: a monocle is one heavy gold ring, the whole read. */
const RIM_WIDTH = 0.032;
const OUTER_EDGE_WIDTH = 0.012;
const CHAIN_WIDTH = 0.016;
/** The chain's links: dashes of gold along it, so it reads as chain rather than wire. */
const LINK_LENGTH = 0.014;
const LINK_GAP = 0.008;
const GLINT_REACH = 0.034;
/** The glint sits high on the rim toward the light. */
const GLINT_ANGLE = -2.3;

/** Where the chain leaves the rim, as an angle round it: low on its outer side. */
const CHAIN_LEAVES_AT = 2.4;
/** Head-on, where the chain's loop bottoms out and where it ends, against the outside of her cheek. */
const CHAIN_SAG: Pt = { x: -0.07, y: 0.17 };
const CHAIN_END: Pt = { x: -0.13, y: 0.07 };
/** In profile the chain falls back along her cheek toward her ear. */
const SIDE_CHAIN_SAG: Pt = { x: -0.02, y: 0.13 };
const SIDE_CHAIN_END: Pt = { x: -0.07, y: 0.05 };
/** From behind, the loop of chain that shows past her cheek, as a share of the skull's half-width. */
const BACK_CHAIN_OUT = 0.95;
const BACK_CHAIN_SAG = 0.12;
const BACK_CHAIN_SPAN = 0.06;

function strokeChain(ctx: Ctx, from: Pt, sag: Pt, to: Pt): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(sag.x, sag.y, to.x, to.y);
  ctx.strokeStyle = GOLD.shadow;
  ctx.lineWidth = CHAIN_WIDTH + OUTER_EDGE_WIDTH / 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([LINK_LENGTH, LINK_GAP]);
  ctx.strokeStyle = GOLD.base;
  ctx.lineWidth = CHAIN_WIDTH;
  ctx.stroke();
  ctx.restore();
}

function paintRim(ctx: Ctx, at: Pt, squash: number, tilt: number): void {
  const r = CAT_LENS_RADIUS;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(tilt);
  ctx.scale(squash, 1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, FULL_TURN);
  ctx.fillStyle = GLASS;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r + RIM_WIDTH / 2, 0, FULL_TURN);
  ctx.strokeStyle = OUTER_EDGE;
  ctx.lineWidth = OUTER_EDGE_WIDTH;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, FULL_TURN);
  ctx.strokeStyle = metalFill(ctx, GOLD, -r, -r, r, r);
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  paintGlint(ctx, GOLD, Math.cos(GLINT_ANGLE) * r, Math.sin(GLINT_ANGLE) * r, GLINT_REACH);
  ctx.restore();
}

/** The point on the rim, in head units, where the chain leaves it. */
function chainStart(at: Pt, squash: number, mirror: number): Pt {
  return {
    x: at.x + mirror * Math.cos(CHAIN_LEAVES_AT) * CAT_LENS_RADIUS * squash,
    y: at.y + Math.sin(CHAIN_LEAVES_AT) * CAT_LENS_RADIUS,
  };
}

/** Head-on: over the eye on screen-left, which is her right, its chain looping down that cheek. */
function paintFront(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const lenses = lensCentres(frame.landmarks, false);
  if (lenses.length === 0) return;
  const [eye] = lenses;
  strokeChain(
    ctx,
    chainStart(eye, 1, 1),
    { x: eye.x + CHAIN_SAG.x, y: CHAIN_SAG.y },
    { x: eye.x + CHAIN_END.x, y: CHAIN_END.y },
  );
  paintRim(ctx, eye, 1, 0);
}

function paintSide(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const lenses = lensCentres(frame.landmarks, true);
  if (lenses.length === 0) return;
  const [eye] = lenses;
  strokeChain(ctx, chainStart(eye, PROFILE_LENS_SQUASH, 1), SIDE_CHAIN_SAG, SIDE_CHAIN_END);
  paintRim(ctx, eye, PROFILE_LENS_SQUASH, PROFILE_LENS_TILT);
}

/** From behind her right is on screen-right: a loop of the chain shows past that cheek. */
function paintBack(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const { skull, eyeLine } = frame.landmarks;
  const x = skull.cx + skull.rx * BACK_CHAIN_OUT;
  strokeChain(
    ctx,
    { x, y: eyeLine },
    { x: x + BACK_CHAIN_SPAN, y: eyeLine + BACK_CHAIN_SAG },
    { x: x - BACK_CHAIN_SPAN, y: eyeLine + BACK_CHAIN_SAG },
  );
}

export const CAT_GILDED_MONOCLE = defineGarment({
  id: 'cat_gilded_monocle',
  name: 'Gilded Monocle',
  wearer: 'cat',
  material: 'jewelry',
  layer: 'outer',
  region: ['head'],
  paint: {
    head: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
